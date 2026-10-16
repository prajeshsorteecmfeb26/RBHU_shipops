# Bonus 1: Microsoft Fabric Readiness

## Goal

Make ShipOps operational data (customers, shipments, status history, chat usage) available for enterprise reporting in Microsoft Fabric, near real time, without adding load or code to the transactional API.

## Recommended approach: Fabric Mirroring of Azure Database for PostgreSQL

Fabric **Mirroring** for Azure Database for PostgreSQL Flexible Server continuously replicates selected tables into OneLake as Delta tables. It is **generally available** and works from PostgreSQL 14 upwards. Under the hood it takes an initial snapshot (Parquet, converted to Delta), then streams changes from the WAL via logical decoding, so there are no ETL jobs or triggers to maintain in the app. [Microsoft Learn: Fabric mirroring concepts](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-fabric-mirroring)

```mermaid
flowchart LR
  subgraph Azure["Azure (VNet)"]
    API[ShipOps API] -->|writes| PG[(PostgreSQL<br/>Flexible Server)]
    AN[Analytics service] -.->|CSV uploads<br/>optional| BLOB[(ADLS Gen2<br/>raw sales files)]
  end
  PG -->|Mirroring: snapshot + CDC<br/>(logical replication, azure_cdc)| M[(Mirrored DB<br/>Delta tables in OneLake)]
  BLOB -->|OneLake shortcut| BR
  subgraph Fabric["Microsoft Fabric workspace: ShipOps Analytics"]
    M --> BR[Bronze<br/>mirrored + shortcut data as-is]
    BR -->|Notebook / Dataflow Gen2<br/>scheduled pipeline| SI[Silver Lakehouse<br/>cleaned, conformed, history]
    SI --> GO[Gold<br/>Warehouse star schema]
    GO --> SM[Semantic model<br/>Direct Lake]
    SM --> PBI[Power BI reports<br/>& Teams/SharePoint embed]
    M --> RTI[Real-Time Intelligence<br/>Eventhouse + Activator alerts]
  end
```

### Why mirroring rather than alternatives

| Option | Latency | Effort | Verdict |
|---|---|---|---|
| **Fabric Mirroring** | near real time (seconds–minutes) | configuration only | ✅ primary choice |
| Data Factory copy pipeline (incremental on `updated_at`) | batch (e.g. 15 min) | moderate: watermark logic, deletes are hard | fallback if mirroring prerequisites can't be met |
| App publishes events → Eventstream | real time | code changes + schema mgmt | add later for event-driven use cases |
| Nightly `pg_dump` / CSV export | daily | low but brittle | ❌ |

## Prerequisites and design implications for ShipOps

| Requirement | ShipOps status / action |
|---|---|
| PostgreSQL 14+ | Flexible Server 16 ✅ |
| System-assigned managed identity on the server | enable in Bicep |
| `wal_level=logical`, `azure_cdc` extension | set by the mirroring enablement workflow (server restart; schedule in the maintenance window) |
| Replication role that **owns** mirrored tables (`azure_cdc_admin`) | create `fabric_user` role; grant ownership of the mirrored tables only |
| Primary key / unique index on every table | all tables have UUID PKs ✅ (avoids the slow `REPLICA IDENTITY FULL` path) |
| Supported data types | `uuid`, `text`, `timestamp`, `integer`, `boolean` ✅; enums should be checked against the supported list (if not supported, mirror a view-free copy or cast in Silver; alternative: store status as `text` with a CHECK constraint) |
| Network | DB is private: use the Fabric **on-premises/VNet data gateway** or Fabric managed private endpoint into the VNet |
| Soft deletes | mirrored as normal updates (`deleted_at` set); Silver applies `WHERE deleted_at IS NULL` for "current" views and keeps history for audit |
| PII | `customers.email` and chat `content` are personal data: exclude `chat_messages` from mirroring (mirror only `conversations` metadata + token counts), hash emails in Silver, apply OneLake security / workspace roles |

## Data flow and model

**Bronze** (as mirrored): `customers`, `shipments`, `shipment_status_history`, `users` (id, role only), plus raw sales CSVs via a OneLake shortcut to the storage account where the analytics service can archive uploads.

**Silver** (Lakehouse, PySpark notebook every 15 minutes):
* `dim_customer` (SCD type 2 on company/status, email hashed)
* `fact_shipment_event` from `shipment_status_history` with durations between events (pickup → delivery time)
* `fact_shipment_current` (latest status per shipment)
* `fact_sales` from uploaded CSVs (salesperson, region, revenue, upload date)
* data-quality checks (orphan FKs, invalid transitions) written to a DQ table

**Gold** (Warehouse star schema): `dim_date`, `dim_customer`, `dim_location` (origin/destination parsed to city/state), `dim_status`, `fact_shipment_lifecycle` (one row per shipment with timestamps per milestone and SLA flags), `fact_sales`.

## Reporting and analytics possibilities

* **Operations dashboard (Power BI, Direct Lake)**: shipments by status/lane, on-time delivery %, average transit time per lane, exceptions by customer, backlog ageing.
* **SLA monitoring**: time in `OutForDelivery`/`Exception` vs. SLA; **Data Activator** sends a Teams alert when an exception isn't resolved within 2 hours (ties in with the announcement in the app).
* **Customer 360**: volume trends, cancellation rate, revenue (joining sales data).
* **Sales analytics at scale**: the same metrics as the Flask service, but across all historical uploads, with row-level security per region manager.
* **Forecasting**: Fabric Data Science notebooks for shipment volume forecasting per lane and delivery-time prediction (features from status history), results written back to Gold and optionally surfaced in the app.
* **AI over data**: Fabric data agent / Copilot in Power BI on the Gold semantic model; the ShipOps assistant could call it for analytical questions it can't answer from the OLTP database.
* **Embedding**: publish reports to Teams and SharePoint (fits the intranet integration in Bonus 3).

## Governance

* Workspaces per environment (dev/prod) with deployment pipelines and Git integration for notebooks and semantic models.
* Microsoft Purview: sensitivity labels on PII columns, lineage from PostgreSQL to report.
* Capacity: start on an F4/F8 SKU; mirroring storage is free up to a capacity-dependent limit, compute for downstream transforms is billed against the capacity.

## Rollout plan

1. Enable managed identity and mirroring prerequisites on the dev server; create `fabric_user`.
2. Create the mirrored database in a dev Fabric workspace for `customers`, `shipments`, `shipment_status_history`.
3. Build Silver/Gold notebooks and a first operations report; validate numbers against the app dashboard.
4. Add DQ checks, RLS, Purview labels; promote with deployment pipelines.
5. Add Activator alerts and forecasting.
