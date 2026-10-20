/**
 * Offline (no-LLM) assistant engine.
 *
 * Used when no OpenAI / Azure OpenAI key is configured, and as a fallback when
 * the real provider is unavailable. It understands the common kinds of
 * operations questions (tracking lookups, status / customer / city filters,
 * counts, lifecycle, how-to, follow-ups) and answers them from live data via
 * the same read-only tools the LLM uses. Anything it cannot classify still gets
 * a useful, data-backed answer (keyword search) instead of a canned reply.
 */
import { ALLOWED_TRANSITIONS, SHIPMENT_STATUSES, type ShipmentStatusValue } from '../shipments/shipment.schemas';
import type { ChatTurn, CompletionResult } from './ai.provider';
import type { ToolExecutor } from './chat.tools';

interface ShipmentRow {
  trackingNumber: string;
  status: string;
  origin: string;
  destination: string;
  customerName?: string;
  customerCompany?: string;
  updatedAt: string;
}
interface ShipmentDetail extends ShipmentRow {
  createdAt: string;
  allowedNextStatuses?: string[];
  statusHistory?: { fromStatus: string | null; toStatus: string; note: string | null; changedBy: string | null; changedAt: string }[];
}
interface CustomerRow { id: string; name: string; company: string; email: string; status: string }
interface Summary { totalCustomers: number; totalShipments: number; statusDistribution: { status: string; count: number }[] }

const TRACKING_RE = /\b[A-Z]{2,5}-[A-Z0-9]{4,}\b/g;
const OPEN: ShipmentStatusValue[] = ['Created', 'PickedUp', 'InTransit', 'OutForDelivery', 'Exception'];

const STATUS_LABEL: Record<ShipmentStatusValue, string> = {
  Created: 'Created',
  PickedUp: 'Picked up',
  InTransit: 'In transit',
  OutForDelivery: 'Out for delivery',
  Delivered: 'Delivered',
  Exception: 'Exception',
  Cancelled: 'Cancelled',
};

const STATUS_MEANING: Record<ShipmentStatusValue, string> = {
  Created: 'the shipment has been booked in ShipOps but not yet collected from the sender.',
  PickedUp: 'the carrier has collected the parcel from the origin.',
  InTransit: 'the parcel is moving through the network between origin and destination hubs.',
  OutForDelivery: 'the parcel is with the last-mile courier and should be delivered today.',
  Delivered: 'the parcel has reached the recipient. This is a final state.',
  Exception: 'something went wrong (delay, failed delivery attempt, damage, address issue) and the shipment needs attention.',
  Cancelled: 'the shipment was cancelled before delivery. This is a final state.',
};

/** Ordered: more specific phrases first. */
const STATUS_SYNONYMS: [RegExp, ShipmentStatusValue][] = [
  [/\bout[\s-]*for[\s-]*delivery\b|\bofd\b|\blast[\s-]*mile\b/, 'OutForDelivery'],
  [/\bin[\s-]*transit\b|\btransit\b|\bon the way\b|\bon route\b|\ben[\s-]?route\b|\bmoving\b|\bshipping now\b/, 'InTransit'],
  [/\bpicked[\s-]*up\b|\bpickedup\b|\bpick[\s-]*ups?\b|\bcollected\b/, 'PickedUp'],
  [/\bdelivered\b|\bcompleted\b|\bfulfilled\b/, 'Delivered'],
  [/\bexceptions?\b|\bdelay(?:ed|s)?\b|\bstuck\b|\bproblems?\b|\bissues?\b|\bfailed\b|\bholds?\b|\bon hold\b|\blate\b/, 'Exception'],
  [/\bcancel+ed\b|\bcancellations?\b/, 'Cancelled'],
  [/\bcreated\b|\bnewly created\b|\bnot (?:yet )?picked\b|\bbooked\b|\bnew shipments?\b/, 'Created'],
];

const STOPWORDS = new Set(
  ('a an the is are was were be been am do does did of to in on at for from by with about and or not no me my our your you i we us ' +
    'it its this that these those what which who whom whose where when why how can could would should will shall may might must ' +
    'please show list give tell find get any all some much many more most there here have has had status shipment shipments ' +
    'customer customers details detail info information about latest current currently now today sir hi hello hey ok okay').split(' '),
);

const fmtDate = (iso?: string) => {
  if (!iso) return 'n/a';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
};
const label = (s: string) => STATUS_LABEL[s as ShipmentStatusValue] ?? s;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function shipmentLine(s: ShipmentRow) {
  return `- **${s.trackingNumber}** - ${label(s.status)} - ${s.origin} -> ${s.destination}${s.customerName ? ` (${s.customerName})` : ''}`;
}

function detectStatuses(q: string): ShipmentStatusValue[] {
  const found: ShipmentStatusValue[] = [];
  let rest = q;
  for (const [re, status] of STATUS_SYNONYMS) {
    if (re.test(rest)) {
      found.push(status);
      rest = rest.replace(new RegExp(re.source, 'g'), ' ');
    }
  }
  return found;
}

const HELP = [
  'Here is what I can help with:',
  '- **Track a shipment** - "Where is SHP-DEMO001004?" or "Show the history of SHP-DEMO001004"',
  '- **Filter shipments** - "List in-transit shipments", "Which shipments have exceptions?", "Shipments from Delhi to Mumbai"',
  '- **Customers** - "Show Fatima Khan\'s shipments", "List all customers", "How many inactive customers?"',
  '- **Operations overview** - "Give me a summary", "How many shipments are delivered?", "What needs attention?"',
  '- **Process questions** - "Explain the shipment lifecycle", "How do I create a shipment?"',
  '- **Customer messages** - "Draft an update for the customer of SHP-DEMO001004"',
].join('\n');

export class OfflineAssistant {
  private toolsUsed: string[] = [];

  constructor(private readonly exec: ToolExecutor) {}

  private async tool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!this.toolsUsed.includes(name)) this.toolsUsed.push(name);
    return (await this.exec(name, args)) as T;
  }

  async answer(turns: ChatTurn[]): Promise<CompletionResult> {
    const content = await this.route(turns);
    return { content, toolsUsed: this.toolsUsed };
  }

  // ------------------------------------------------------------------ routing
  private async route(turns: ChatTurn[]): Promise<string> {
    const raw = ([...turns].reverse().find((t) => t.role === 'user')?.content ?? '').trim();
    const q = raw.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
    if (!q) return HELP;

    // 1. Explicit tracking numbers
    const tracking = [...new Set(raw.toUpperCase().match(TRACKING_RE) ?? [])].slice(0, 5);
    if (tracking.length) return this.trackingAnswer(tracking, q);

    // 2. Small talk / help
    if (/^(hi|hello|hey|hii+|hai|good (morning|afternoon|evening)|namaste|yo|greetings)\b[\s!.,?]*([a-z]+[\s!.,?]*)?$/.test(q)) {
      return `Hello! I'm the ShipOps Assistant. ${HELP}`;
    }
    if (/^(thanks|thank you|thx|ty|great|cool|nice|awesome|perfect|got it|ok(ay)?)\b/.test(q) && q.length < 40) {
      return "You're welcome! Ask me anything else about shipments, customers or operations.";
    }
    if (/\b(help|what can you do|what do you do|capabilit|how (do|can) i use you|who are you|what are you|examples?)\b/.test(q) && q.length < 80) {
      return HELP;
    }

    // 3. Follow-up about a shipment mentioned earlier in this conversation
    const ctxTracking = this.trackingFromHistory(turns);
    if (ctxTracking && /\b(it|its|it's|this|that|the shipment|same|history|timeline|journey|when|customer|who|route|where|status|eta|next|draft|message|email|notify|update)\b/.test(q)
      && !/\b(all|every|list|how many|count|summary|overview|most|top|shipments|customers)\b/.test(q)) {
      return this.trackingAnswer([ctxTracking], q);
    }

    // Off-topic questions (even if they mention a city we serve)
    if (/\b(weather|temperature|rain|joke|movie|film|song|music|recipe|cook|cricket|football|ipl|politic|election|stock price|bitcoin|crypto|poem|story|horoscope|girlfriend|boyfriend)\b/.test(q)
      && !/\b(shipments?|parcels?|deliver|tracking|customers?)\b/.test(q)) {
      return `That's outside what I can help with here - I'm focused on ShipOps operations.\n\n${HELP}`;
    }

    // 4. How-to / write requests (the assistant is read-only)
    const howTo = this.howToAnswer(q);
    if (howTo) return howTo;

    // 5. Lifecycle / status meaning
    const lifecycle = this.lifecycleAnswer(q);
    if (lifecycle) return lifecycle;

    // 6. Sales analytics
    if (/\b(sales|revenue|profit|orders?|csv|excel|forecast|trend|analytics|kpi|top products?|top regions?)\b/.test(q)
      && !/\bshipments?\b/.test(q) && !detectStatuses(q).length) {
      return this.salesAnswer();
    }

    // 7. Data questions (customers, statuses, cities, counts)
    const data = await this.dataAnswer(q);
    if (data) return data;

    // 8. General logistics glossary
    const glossary = this.glossaryAnswer(q);
    if (glossary) return glossary;

    // 9. Last resort: keyword search across live data
    return this.searchAnswer(raw, q);
  }

  private trackingFromHistory(turns: ChatTurn[]): string | undefined {
    const prior = turns.filter((t) => t.role !== 'system').slice(0, -1).reverse();
    for (const t of prior) {
      const m = t.content.toUpperCase().match(TRACKING_RE);
      if (m?.length) return m[0];
    }
    return undefined;
  }

  // --------------------------------------------------------------- tracking
  private async trackingAnswer(numbers: string[], q: string): Promise<string> {
    const wantsHistory = /\b(why|reason|history|timeline|journey|events?|log|track(ing)? details|full details|all updates|when did|how long)\b/.test(q);
    const wantsDraft = /\b(draft|write|compose|message|email|mail|sms|notify|reply|respond|update (the )?customer|inform)\b/.test(q);
    const wantsCustomer = /\b(customer|who|whose|sender|client|owner|contact)\b/.test(q);
    const wantsNext = /\b(next|allowed|can (it|i) (move|change)|transition)\b/.test(q);

    const parts: string[] = [];
    for (const tn of numbers) {
      const r = await this.tool<{ found: boolean; shipment?: ShipmentDetail; reason?: string }>('get_shipment_by_tracking_number', { trackingNumber: tn });
      if (!r.found || !r.shipment) {
        parts.push(`I couldn't find a shipment with tracking number **${tn}**. Please double-check it (format like SHP-ABC1234567).`);
        continue;
      }
      const s = r.shipment;
      const hist = s.statusHistory ?? [];
      const last = hist[hist.length - 1];

      if (wantsDraft) {
        parts.push(this.draftMessage(s));
        continue;
      }

      const lines = [`**${s.trackingNumber}** is currently **${label(s.status)}**.`];
      lines.push(`- Route: ${s.origin} -> ${s.destination}`);
      lines.push(`- Customer: ${s.customerName ?? 'n/a'}${s.customerCompany ? ` (${s.customerCompany})` : ''}`);
      lines.push(`- Last update: ${fmtDate(s.updatedAt)}${last?.note ? ` - "${last.note}"` : ''}`);
      if (wantsHistory || hist.length <= 1 || wantsNext) {
        if (hist.length) {
          lines.push('', '**Status history:**');
          hist.forEach((h, i) => lines.push(`${i + 1}. ${label(h.toStatus)} - ${fmtDate(h.changedAt)}${h.note ? ` - ${h.note}` : ''}${h.changedBy ? ` (by ${h.changedBy})` : ''}`));
        }
      }
      if (s.status === 'Exception') lines.push('', 'This shipment is in **Exception** and needs attention. It can move to In transit, Out for delivery or Cancelled once resolved.');
      if (wantsNext || wantsHistory) {
        const next = s.allowedNextStatuses ?? ALLOWED_TRANSITIONS[s.status as ShipmentStatusValue] ?? [];
        lines.push(next.length ? `- Allowed next statuses: ${next.map(label).join(', ')}` : '- This is a final status; no further changes are allowed.');
      }
      if (wantsCustomer && s.customerName) {
        const c = await this.tool<{ found: boolean; customer?: CustomerRow; totalShipments?: number }>('get_customer_details', { query: s.customerName });
        if (c.found && c.customer) lines.push(`- Customer contact: ${c.customer.email} - ${c.customer.status}, ${plural(c.totalShipments ?? 0, 'shipment')} in total`);
      }
      parts.push(lines.join('\n'));
    }
    return parts.join('\n\n');
  }

  private draftMessage(s: ShipmentDetail): string {
    const name = s.customerName?.split(' ')[0] ?? 'there';
    const body: Record<string, string> = {
      Created: `your shipment has been booked and is awaiting pickup from ${s.origin}.`,
      PickedUp: `your shipment has been picked up in ${s.origin} and will soon be on its way to ${s.destination}.`,
      InTransit: `your shipment is in transit from ${s.origin} to ${s.destination} and progressing as planned.`,
      OutForDelivery: `your shipment is out for delivery in ${s.destination} today.`,
      Delivered: `your shipment from ${s.origin} has been delivered in ${s.destination}.`,
      Exception: `there is a delay with your shipment from ${s.origin} to ${s.destination}. Our team is working on it and will update you shortly.`,
      Cancelled: `your shipment from ${s.origin} to ${s.destination} has been cancelled. Please contact us if this is unexpected.`,
    };
    return [
      `Here is a draft update for **${s.customerName ?? 'the customer'}** about **${s.trackingNumber}**:`,
      '',
      `> Hi ${name},`,
      `>`,
      `> Quick update on shipment ${s.trackingNumber}: ${body[s.status] ?? `its current status is ${label(s.status)}.`}`,
      `>`,
      `> Thank you for shipping with us.`,
      `> - ShipOps Operations Team`,
    ].join('\n');
  }

  // ----------------------------------------------------------------- how-to
  private howToAnswer(q: string): string | undefined {
    const action = /\b(how (do|can|to|should)|how'?s|steps? to|way to|can you|could you|please|i want to|i need to|help me)\b/.test(q) || /^(create|add|make|update|edit|change|delete|remove|cancel|mark|set|move|upload|export|download|log ?in|sign ?(in|out)|reset)\b/.test(q);
    if (!action || /\bupdate me\b|\bupdates? on\b/.test(q)) return undefined;
    const write = /\b(create|add|make|book|update|edit|change|modify|delete|remove|cancel|mark|set|move|deactivate|activate)\b/.test(q);
    const ship = /\bshipments?|parcel|package|consignment|status\b/.test(q);
    const cust = /\bcustomers?|client\b/.test(q);

    if (write && ship) {
      if (/\b(cancel)\b/.test(q)) return 'I\'m read-only, but you can cancel it yourself:\n1. Open **Shipments** and click the shipment.\n2. Choose **Update status** -> **Cancelled** (allowed from Created, Picked up or Exception).\n3. Add an optional note and save. Delivered shipments cannot be cancelled.';
      if (/\b(create|add|make|book)\b/.test(q)) return 'I\'m read-only, but creating a shipment takes a few seconds:\n1. Go to **Shipments** -> **New shipment**.\n2. Pick an **Active** customer, enter origin and destination (they must differ).\n3. Leave tracking number empty to auto-generate one (SHP-XXXXXXXXXX). New shipments start as **Created**.';
      return 'I\'m read-only, but you can update a shipment status here:\n1. Open **Shipments** and select the shipment.\n2. Click **Update status** - only valid next statuses are offered (e.g. In transit -> Out for delivery).\n3. Add a note (optional) and save. Everyone gets a real-time notification.\n\nAsk me "explain the shipment lifecycle" to see all allowed transitions.';
    }
    if (write && cust) {
      if (/\b(delete|remove|deactivate)\b/.test(q)) return 'I\'m read-only. To remove a customer: open **Customers**, find the row and click **Delete**. It is a soft delete (kept for audit, hidden from lists). Admin/Operator role required.';
      if (/\b(create|add|new|make)\b/.test(q)) return 'I\'m read-only. To add a customer: go to **Customers** -> **New customer**, fill in name, company and a unique email, then save. Only Active customers can receive new shipments.';
      return 'I\'m read-only. To edit a customer: open **Customers**, click the customer row, change the fields (name, company, email, Active/Inactive) and save.';
    }
    if (/\b(upload|import|analy[sz]e)\b/.test(q) && /\b(csv|file|sales|data|excel)\b/.test(q)) return this.salesAnswer();
    if (/\b(log ?out|sign ?out)\b/.test(q)) return 'Click **Sign out** at the bottom of the left sidebar.';
    if (/\b(password|log ?in|sign ?in)\b/.test(q)) return 'Sign in from the login page with your ShipOps email and password. Password resets are handled by an Admin.';
    if (/\b(notification|bell|alert)\b/.test(q)) return 'Real-time notifications appear under the **bell icon** (top right) whenever a shipment is created or its status changes. The badge next to it shows whether the live connection is Online.';
    return undefined;
  }

  // -------------------------------------------------------------- lifecycle
  private lifecycleAnswer(q: string): string | undefined {
    const lifecycle = /\b(lifecycle|life cycle|stages?|workflow|flow|state machine|transitions?|all statuses|status(es)? (list|types|options|values|available|possible)|what statuses|which statuses|possible statuses|types of status)\b/.test(q);
    const meaning = /\b(mean|meaning|means|definition|define|what is|what's|what does|explain)\b/.test(q);
    const statuses = detectStatuses(q);
    if (meaning && statuses.length && !/\b(how many|list|show|which shipments|count)\b/.test(q)) {
      return statuses
        .map((s) => {
          const next = ALLOWED_TRANSITIONS[s];
          return `**${label(s)}** means ${STATUS_MEANING[s]}\n- Can move to: ${next.length ? next.map(label).join(', ') : 'nothing (final status)'}`;
        })
        .join('\n\n');
    }
    if (!lifecycle && !(meaning && /\bstatus/.test(q))) return undefined;
    const lines = [
      'Shipment lifecycle in ShipOps:',
      '**Created -> Picked up -> In transit -> Out for delivery -> Delivered**, with **Exception** and **Cancelled** as side states.',
      '',
      '**Allowed transitions:**',
      ...SHIPMENT_STATUSES.map((s) => `- ${label(s)} -> ${ALLOWED_TRANSITIONS[s].length ? ALLOWED_TRANSITIONS[s].map(label).join(', ') : '(final)'}`),
      '',
      'Any other change (e.g. Delivered back to In transit) is rejected by the system.',
    ];
    return lines.join('\n');
  }

  private salesAnswer(): string {
    return [
      'Sales data is analysed on the **Sales analytics** page (left sidebar), not stored in the shipments database:',
      '1. Open **Sales analytics** and upload a CSV/Excel sales file.',
      '2. You get totals, trends over time, top products / regions and charts generated by the analytics service.',
      '',
      'For shipment and customer numbers, ask me e.g. "give me a summary" or "how many shipments are delivered?".',
    ].join('\n');
  }

  private glossaryAnswer(q: string): string | undefined {
    const g: [RegExp, string][] = [
      [/\btracking number\b/, 'A **tracking number** uniquely identifies a shipment (in ShipOps: SHP- followed by 10 characters). Give me one and I will look it up.'],
      [/\beta\b|estimated (time|delivery)/, 'ShipOps does not store ETAs. The best indicator is the status: **Out for delivery** means delivery is expected today; **In transit** means it is between hubs.'],
      [/\bproof of delivery\b|\bpod\b/, '**Proof of delivery (POD)** is the confirmation that the recipient received the parcel. In ShipOps a shipment is confirmed when its status becomes **Delivered**.'],
      [/\bfreight\b/, '**Freight** refers to goods transported in bulk by truck, rail, sea or air. ShipOps tracks individual shipments from origin to destination.'],
      [/\b(rbac|roles?|permissions?|admin|operator|viewer)\b/, 'ShipOps roles: **Admin** (full access), **Operator** (manage customers and shipments) and **Viewer** (read-only).'],
    ];
    return g.find(([re]) => re.test(q))?.[1];
  }

  // ------------------------------------------------------------------- data
  private async loadCustomers(): Promise<CustomerRow[]> {
    const r = await this.tool<{ customers: CustomerRow[] }>('list_customers', {});
    return r.customers ?? [];
  }

  private matchCustomer(q: string, customers: CustomerRow[]): CustomerRow | undefined {
    const words = new Set(q.split(/[^a-z0-9@.]+/).filter(Boolean));
    let best: { c: CustomerRow; score: number } | undefined;
    for (const c of customers) {
      let score = 0;
      const name = c.name.toLowerCase();
      const company = c.company.toLowerCase();
      if (q.includes(c.email.toLowerCase())) score = 100;
      else if (q.includes(name)) score = 90;
      else if (q.includes(company)) score = 85;
      else {
        const parts = [...name.split(' '), ...company.split(' ')].filter((p) => p.length >= 4 && !STOPWORDS.has(p) && !['logistics', 'traders', 'retail', 'foods', 'pharma', 'electronics'].includes(p));
        const hits = parts.filter((p) => words.has(p) || words.has(`${p}'s`) || q.includes(`${p}'s`));
        if (hits.length) score = 50 + hits.length;
      }
      if (score && (!best || score > best.score)) best = { c, score };
    }
    return best?.c;
  }

  private async loadAllShipments(): Promise<ShipmentRow[]> {
    const r = await this.tool<{ shipments: ShipmentRow[] }>('list_shipments', { limit: 50 });
    return r.shipments ?? [];
  }

  private matchLocations(q: string, shipments: ShipmentRow[]): { from?: string; to?: string; any?: string } {
    const cities = new Set<string>();
    for (const s of shipments) for (const loc of [s.origin, s.destination]) cities.add(loc.split(',')[0].trim());
    const mentioned = [...cities].filter((c) => c.length >= 3 && new RegExp(`\\b${c.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q));
    const out: { from?: string; to?: string; any?: string } = {};
    // "Navi Mumbai" also contains "Mumbai": keep only the longer name unless both appear separately
    const distinct = mentioned.filter(
      (c) => !mentioned.some((o) => o !== c && o.toLowerCase().includes(c.toLowerCase()) && q.split(o.toLowerCase()).join(' ').search(new RegExp(`\\b${c.toLowerCase()}\\b`)) === -1),
    );
    for (const c of distinct) {
      const lc = c.toLowerCase();
      if (new RegExp(`\\b(from|origin|leaving|out of|dispatched from|shipped from)\\s+${lc}\\b`).test(q)) out.from = c;
      else if (new RegExp(`\\b(to|into|destination|going to|bound for|towards|for)\\s+${lc}\\b`).test(q)) out.to = c;
      else if (!out.any) out.any = c;
    }
    if (out.any && !out.from && !out.to && distinct.length >= 2) {
      // "Delhi Mumbai shipments" -> treat as route
      out.from = distinct[0];
      out.to = distinct[1];
      delete out.any;
    }
    return out;
  }

  private async dataAnswer(q: string): Promise<string | undefined> {
    const counting = /\b(how many|number of|count|total|how much|percentage|percent|ratio|rate)\b/.test(q);
    const mentionsCustomers = /\b(customers?|clients?|accounts?|companies|company)\b/.test(q);
    const mentionsShipments = /\b(shipments?|parcels?|packages?|orders?|deliveries|consignments?|tracking)\b/.test(q);
    const openish = /\b(open|active shipments?|pending|in progress|ongoing|undelivered|not (yet )?delivered|outstanding|remaining|unfinished|live shipments?)\b/.test(q);
    const attention = /\b(attention|urgent|priority|critical|risk|problems?|issues?|stuck|delay(ed|s)?|late|exceptions?|alerts?)\b/.test(q);
    const recent = /\b(recent|latest|last|newest|new|today|this week|updated)\b/.test(q);
    const summary = /\b(summary|summari[sz]e|overview|stats|statistics|dashboard|report|breakdown|distribution|kpis?|health|snapshot|status of (all|operations)|operations)\b/.test(q);
    let statuses = detectStatuses(q);

    // ---- ranking customers
    if (mentionsCustomers && /\b(top|most|biggest|largest|best|highest|ranking|rank)\b/.test(q)) return this.topCustomers();

    // ---- customer-specific question
    const customers = await this.loadCustomers();
    const customer = this.matchCustomer(q, customers);
    if (customer) return this.customerAnswer(customer, statuses, q);

    // ---- customers in general
    if (mentionsCustomers && !mentionsShipments && !statuses.length) {
      const wantInactive = /\binactive|disabled|deactivated\b/.test(q);
      const wantActive = !wantInactive && /\bactive\b/.test(q);
      const list = customers.filter((c) => (wantInactive ? c.status === 'Inactive' : wantActive ? c.status === 'Active' : true));
      const which = wantInactive ? 'inactive ' : wantActive ? 'active ' : '';
      if (counting && !/\b(list|show|who|which|names?)\b/.test(q)) {
        const act = customers.filter((c) => c.status === 'Active').length;
        return `There are **${list.length}** ${which}customers${which ? '' : ` (${act} Active, ${customers.length - act} Inactive)`}.`;
      }
      if (!list.length) return `There are no ${which}customers right now.`;
      return [`**${plural(list.length, `${which}customer`)}:**`, ...list.map((c) => `- **${c.name}** - ${c.company} - ${c.email} (${c.status})`)].join('\n');
    }

    // ---- open / attention synonyms
    if (openish && !statuses.length) statuses = [...OPEN];
    if (attention && !statuses.includes('Exception') && !openish) statuses = ['Exception', ...statuses];

    // ---- location filter
    let shipmentsAll: ShipmentRow[] | undefined;
    const needLoc = /\b(from|to|in|at|via|between|city|cities|route|routes|lane)\b/.test(q) || mentionsShipments || statuses.length > 0 || counting;
    let loc: { from?: string; to?: string; any?: string } = {};
    if (needLoc) {
      shipmentsAll = await this.loadAllShipments();
      loc = this.matchLocations(q, shipmentsAll);
    }
    const hasLoc = !!(loc.from || loc.to || loc.any);

    if (/\b(routes?|lanes?|cities|busiest|popular)\b/.test(q) && !hasLoc) return this.routesAnswer();

    if (statuses.length || hasLoc) return this.filteredShipments(statuses, loc, counting, q);

    if (summary || (counting && (mentionsShipments || !mentionsCustomers))) return this.summaryAnswer(q);

    if (mentionsShipments && recent) {
      const r = await this.tool<{ total: number; shipments: ShipmentRow[] }>('list_shipments', { limit: 5 });
      if (!r.shipments.length) return 'There are no shipments yet.';
      return [`**Most recently updated shipments** (of ${r.total}):`, ...r.shipments.map((s) => `${shipmentLine(s)} - ${fmtDate(s.updatedAt)}`)].join('\n');
    }
    if (mentionsShipments && /\b(all|list|show|every|display)\b/.test(q)) {
      const r = await this.tool<{ total: number; shipments: ShipmentRow[] }>('list_shipments', { limit: 15 });
      return [`**${plural(r.total, 'shipment')}** in total${r.total > r.shipments.length ? ` (showing the ${r.shipments.length} most recently updated)` : ''}:`, ...r.shipments.map(shipmentLine)].join('\n');
    }
    if (attention) return this.filteredShipments(['Exception'], {}, false, q);
    return undefined;
  }

  private async customerAnswer(c: CustomerRow, statuses: ShipmentStatusValue[], q: string): Promise<string> {
    const r = await this.tool<{ found: boolean; customer?: CustomerRow & { createdAt?: string }; totalShipments: number; statusCounts: Record<string, number>; shipments: ShipmentRow[] }>(
      'get_customer_details',
      { query: c.email },
    );
    if (!r.found || !r.customer) return `I couldn't load details for ${c.name}.`;
    const counting = /\b(how many|number of|count|total)\b/.test(q);
    let rows = r.shipments;
    if (statuses.length) rows = rows.filter((s) => statuses.includes(s.status as ShipmentStatusValue));
    const statusText = statuses.map(label).join(' / ');

    if (counting && statuses.length) {
      return `**${r.customer.name}** (${r.customer.company}) has **${plural(rows.length, `${statusText.toLowerCase()} shipment`)}** out of ${r.totalShipments} in total.`;
    }
    const lines = [
      `**${r.customer.name}** - ${r.customer.company}`,
      `- Email: ${r.customer.email}`,
      `- Status: ${r.customer.status}`,
      `- Shipments: **${r.totalShipments}**${Object.keys(r.statusCounts).length ? ` (${Object.entries(r.statusCounts).map(([s, n]) => `${label(s)}: ${n}`).join(', ')})` : ''}`,
    ];
    if (rows.length) {
      lines.push('', statuses.length ? `**${statusText} shipments:**` : '**Shipments (most recent first):**', ...rows.slice(0, 10).map(shipmentLine));
      if (rows.length > 10) lines.push(`- ...and ${rows.length - 10} more`);
    } else if (statuses.length) {
      lines.push('', `No ${statusText.toLowerCase()} shipments for this customer.`);
    }
    if (r.customer.status === 'Inactive') lines.push('', '_This customer is Inactive, so new shipments cannot be created for them._');
    return lines.join('\n');
  }

  private async filteredShipments(statuses: ShipmentStatusValue[], loc: { from?: string; to?: string; any?: string }, counting: boolean, q: string): Promise<string> {
    // Fetch per status (or once without status) filtered by location, then refine origin/destination direction
    const locSearch = loc.from ?? loc.to ?? loc.any;
    const sets = statuses.length ? statuses : [undefined];
    let rows: ShipmentRow[] = [];
    let total = 0;
    for (const status of sets) {
      const r = await this.tool<{ total: number; shipments: ShipmentRow[] }>('list_shipments', { ...(status ? { status } : {}), ...(locSearch ? { location: locSearch } : {}), limit: 50 });
      rows.push(...r.shipments);
      total += r.total;
    }
    const has = (place: string, city: string) => place.split(',')[0].trim().toLowerCase() === city.toLowerCase();
    if (loc.from) rows = rows.filter((s) => has(s.origin, loc.from!));
    if (loc.to) rows = rows.filter((s) => has(s.destination, loc.to!));
    if (loc.any) rows = rows.filter((s) => has(s.origin, loc.any!) || has(s.destination, loc.any!));
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // Exact count from the database unless we had to post-filter by direction
    if (loc.from || loc.to) total = rows.length;

    const statusText = statuses.length === OPEN.length && OPEN.every((s) => statuses.includes(s)) ? 'open (not yet delivered or cancelled)' : statuses.map(label).join(' / ').toLowerCase();
    const where = loc.from && loc.to ? ` from ${loc.from} to ${loc.to}` : loc.from ? ` from ${loc.from}` : loc.to ? ` to ${loc.to}` : loc.any ? ` involving ${loc.any}` : '';
    const what = `${statusText ? `${statusText} ` : ''}shipment`;

    if (!rows.length) return `There are **no ${what}s${where}** right now.${statuses.includes('Exception') ? ' Nothing needs attention.' : ''}`;
    if (counting && !/\b(list|show|which|what are|names?)\b/.test(q)) {
      const summary = await this.tool<Summary>('get_operations_summary', {});
      const pct = summary.totalShipments ? Math.round((total / summary.totalShipments) * 100) : 0;
      return `There ${total === 1 ? 'is' : 'are'} **${plural(total, what)}${where}** (${pct}% of ${summary.totalShipments} total).`;
    }
    const lines = [`**${plural(total, what)}${where}:**`, ...rows.slice(0, 15).map(shipmentLine)];
    if (total > 15) lines.push(`- ...and ${total - 15} more (see the **Shipments** page for the full list)`);
    if (statuses.includes('Exception') && rows.some((s) => s.status === 'Exception')) lines.push('', 'Exception shipments need follow-up: check the latest note, then move them back to In transit / Out for delivery, or Cancel.');
    return lines.join('\n');
  }

  private async summaryAnswer(q: string): Promise<string> {
    const s = await this.tool<Summary>('get_operations_summary', {});
    const by = Object.fromEntries(s.statusDistribution.map((d) => [d.status, d.count])) as Record<string, number>;
    const open = OPEN.reduce((n, st) => n + (by[st] ?? 0), 0);
    const delivered = by.Delivered ?? 0;
    const pct = (n: number) => (s.totalShipments ? `${Math.round((n / s.totalShipments) * 100)}%` : '0%');
    if (/\bcustomers?\b/.test(q) && !/\bshipments?\b/.test(q)) return `There are **${s.totalCustomers}** customers.`;
    const lines = [
      `**Operations summary:** ${s.totalCustomers} customers and ${s.totalShipments} shipments.`,
      ...s.statusDistribution.filter((d) => d.count > 0).map((d) => `- ${label(d.status)}: ${d.count} (${pct(d.count)})`),
      '',
      `- Delivered rate: **${pct(delivered)}** - Open shipments: **${open}**${by.Exception ? ` - Needing attention (Exception): **${by.Exception}**` : ''}`,
    ];
    if (by.Exception) lines.push('', 'Ask "which shipments have exceptions?" to see them.');
    return lines.join('\n');
  }

  private async topCustomers(): Promise<string> {
    const customers = await this.loadCustomers();
    const counts: [string, string, number][] = [];
    for (const c of customers) {
      const d = await this.tool<{ found: boolean; totalShipments?: number }>('get_customer_details', { query: c.email });
      counts.push([c.name, c.company, d.totalShipments ?? 0]);
    }
    const top = counts.filter((c) => c[2] > 0).sort((a, b) => b[2] - a[2]).slice(0, 5);
    if (!top.length) return 'No shipments yet, so there are no top customers.';
    return ['**Top customers by number of shipments:**', ...top.map(([n, co, c], i) => `${i + 1}. ${n} (${co}) - ${plural(c, 'shipment')}`)].join('\n');
  }

  private async routesAnswer(): Promise<string> {
    const rows = await this.loadAllShipments();
    const lanes = new Map<string, number>();
    const cities = new Map<string, number>();
    for (const s of rows) {
      lanes.set(`${s.origin} -> ${s.destination}`, (lanes.get(`${s.origin} -> ${s.destination}`) ?? 0) + 1);
      for (const c of [s.origin, s.destination]) cities.set(c, (cities.get(c) ?? 0) + 1);
    }
    if (!rows.length) return 'There are no shipments yet.';
    return [
      '**Busiest routes:**',
      ...[...lanes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l, n]) => `- ${l}: ${plural(n, 'shipment')}`),
      '',
      '**Cities served:** ' + [...cities.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (${n})`).join(', '),
    ].join('\n');
  }

  // ----------------------------------------------------------------- search
  private async searchAnswer(raw: string, q: string): Promise<string> {
    const terms = [...new Set(q.split(/[^a-z0-9@.-]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w)))].slice(0, 6);
    const lines: string[] = [];
    for (const term of terms) {
      const c = await this.tool<{ total: number; customers: CustomerRow[] }>('search_customers', { query: term });
      for (const cu of c.customers ?? []) lines.push(`- Customer **${cu.name}** - ${cu.company} - ${cu.email} (${cu.status})`);
      const s = await this.tool<{ total: number; shipments: ShipmentRow[] }>('list_shipments', { location: term, limit: 5 });
      for (const sh of s.shipments ?? []) lines.push(shipmentLine(sh));
      if (lines.length >= 10) break;
    }
    const uniq = [...new Set(lines)];
    if (uniq.length) return [`Here is what I found in ShipOps for "${raw.slice(0, 80)}":`, ...uniq.slice(0, 10)].join('\n');

    const offTopic = /\b(weather|joke|movie|song|recipe|cricket|football|politic|stock|bitcoin|love|poem|story|news|game)\b/.test(q);
    return [
      offTopic
        ? "That's outside what I can help with here - I'm focused on ShipOps operations."
        : `I couldn't find anything in ShipOps matching "${raw.slice(0, 80)}".`,
      '',
      HELP,
    ].join('\n');
  }
}
