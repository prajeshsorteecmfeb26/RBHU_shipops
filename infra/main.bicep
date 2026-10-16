// ShipOps - Azure infrastructure (Module 6)
// Deploy: az deployment group create -g <rg> -f infra/main.bicep -p infra/main.dev.bicepparam
targetScope = 'resourceGroup'

@description('Environment short name')
@allowed(['dev', 'prod'])
param env string = 'dev'

param location string = resourceGroup().location

@description('Container image tag to deploy (git SHA)')
param imageTag string = 'latest'

@description('PostgreSQL administrator login (break-glass; apps use Entra auth / Key Vault)')
param pgAdminLogin string = 'shipopsadmin'

@secure()
@description('PostgreSQL administrator password')
param pgAdminPassword string

@description('Browser origins allowed by the API (CORS + WebSocket origin check)')
param corsOrigins string

@description('Deploy an Azure OpenAI account + model deployment')
param deployOpenAI bool = true

@description('Entra tenant for API token validation and DB auth')
param tenantId string = subscription().tenantId

@description('App ID URI of the ShipOps API app registration')
param entraApiAudience string = 'api://shipops-api'

var isProd = env == 'prod'
var suffix = '${env}-${uniqueString(resourceGroup().id)}'
var tags = { app: 'shipops', env: env }

// ---------------------------------------------------------------- monitoring
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-shipops-${suffix}'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: isProd ? 90 : 30 }
}

resource appi 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-shipops-${suffix}'
  location: location
  kind: 'web'
  tags: tags
  properties: { Application_Type: 'web', WorkspaceResourceId: logs.id }
}

// ---------------------------------------------------------------- network
resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'vnet-shipops-${env}'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.20.0.0/16'] }
    subnets: [
      {
        name: 'snet-appsvc'
        properties: {
          addressPrefix: '10.20.1.0/24'
          delegations: [{ name: 'web', properties: { serviceName: 'Microsoft.Web/serverFarms' } }]
        }
      }
      {
        name: 'snet-pe'
        properties: { addressPrefix: '10.20.2.0/24', privateEndpointNetworkPolicies: 'Enabled' }
      }
    ]
  }
}
var appSubnetId = vnet.properties.subnets[0].id
var peSubnetId = vnet.properties.subnets[1].id

var dnsZoneNames = [
  'privatelink.postgres.database.azure.com'
  'privatelink.vaultcore.azure.net'
  'privatelink.azurewebsites.net'
  'privatelink.openai.azure.com'
]

resource dnsZones 'Microsoft.Network/privateDnsZones@2020-06-01' = [for z in dnsZoneNames: {
  name: z
  location: 'global'
  tags: tags
}]

resource dnsLinks 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = [for (z, i) in dnsZoneNames: {
  parent: dnsZones[i]
  name: 'link-${vnet.name}'
  location: 'global'
  properties: { registrationEnabled: false, virtualNetwork: { id: vnet.id } }
}]

// ---------------------------------------------------------------- registry
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'crshipops${replace(suffix, '-', '')}'
  location: location
  tags: tags
  sku: { name: isProd ? 'Standard' : 'Basic' }
  properties: { adminUserEnabled: false }
}

// ---------------------------------------------------------------- key vault
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: take('kv-shipops-${suffix}', 24)
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Disabled'
    networkAcls: { defaultAction: 'Deny', bypass: 'AzureServices' }
  }
}

// ---------------------------------------------------------------- postgres
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'psql-shipops-${suffix}'
  location: location
  tags: tags
  sku: isProd ? { name: 'Standard_D2ds_v5', tier: 'GeneralPurpose' } : { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: pgAdminLogin
    administratorLoginPassword: pgAdminPassword
    authConfig: { activeDirectoryAuth: 'Enabled', passwordAuth: 'Enabled', tenantId: tenantId }
    storage: { storageSizeGB: isProd ? 128 : 32, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: isProd ? 35 : 7, geoRedundantBackup: isProd ? 'Enabled' : 'Disabled' }
    highAvailability: { mode: isProd ? 'ZoneRedundant' : 'Disabled' }
    network: { publicNetworkAccess: 'Disabled' }
    maintenanceWindow: { customWindow: 'Enabled', dayOfWeek: 0, startHour: 20, startMinute: 30 } // Sun 02:00 IST
  }
}

resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: 'shipops'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

resource pgTls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: pg
  name: 'require_secure_transport'
  properties: { value: 'on', source: 'user-override' }
}

// ---------------------------------------------------------------- azure openai
resource openai 'Microsoft.CognitiveServices/accounts@2024-10-01' = if (deployOpenAI) {
  name: 'oai-shipops-${suffix}'
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: 'oai-shipops-${suffix}'
    publicNetworkAccess: 'Disabled'
    disableLocalAuth: true // keyless: managed identity only
  }
}

resource openaiModel 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = if (deployOpenAI) {
  parent: openai
  name: 'gpt-4o-mini'
  sku: { name: 'GlobalStandard', capacity: 30 }
  properties: { model: { format: 'OpenAI', name: 'gpt-4o-mini', version: '2024-07-18' } }
}

// ---------------------------------------------------------------- app service
resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'asp-shipops-${env}'
  location: location
  tags: tags
  kind: 'linux'
  sku: { name: 'P1v3', capacity: isProd ? 3 : 1 }
  properties: { reserved: true, zoneRedundant: isProd }
}

var kvRef = 'https://${kv.name}${environment().suffixes.keyvaultDns}/secrets'
var commonSiteConfig = {
  alwaysOn: true
  http20Enabled: true
  minTlsVersion: '1.2'
  ftpsState: 'Disabled'
  vnetRouteAllEnabled: true
  acrUseManagedIdentityCreds: true
}

resource analytics 'Microsoft.Web/sites@2024-04-01' = {
  name: 'app-shipops-analytics-${suffix}'
  location: location
  tags: tags
  kind: 'app,linux,container'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    publicNetworkAccess: 'Disabled'
    virtualNetworkSubnetId: appSubnetId
    siteConfig: union(commonSiteConfig, {
      linuxFxVersion: 'DOCKER|${acr.properties.loginServer}/shipops-analytics:${imageTag}'
      healthCheckPath: '/health'
      appSettings: [
        { name: 'WEBSITES_PORT', value: '5001' }
        { name: 'INTERNAL_API_KEY', value: '@Microsoft.KeyVault(SecretUri=${kvRef}/analytics-internal-key/)' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appi.properties.ConnectionString }
      ]
    })
  }
}

var apiSettings = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'WEBSITES_PORT', value: '4000' }
  { name: 'DATABASE_URL', value: '@Microsoft.KeyVault(SecretUri=${kvRef}/database-url/)' }
  { name: 'CORS_ORIGINS', value: corsOrigins }
  { name: 'AUTH_MODE', value: isProd ? 'entra' : 'local' }
  { name: 'JWT_SECRET', value: '@Microsoft.KeyVault(SecretUri=${kvRef}/jwt-secret/)' }
  { name: 'ENTRA_TENANT_ID', value: tenantId }
  { name: 'ENTRA_API_AUDIENCE', value: entraApiAudience }
  { name: 'AI_PROVIDER', value: deployOpenAI ? 'azure' : 'mock' }
  { name: 'AZURE_OPENAI_ENDPOINT', value: deployOpenAI ? 'https://oai-shipops-${suffix}.openai.azure.com' : '' }
  { name: 'AZURE_OPENAI_DEPLOYMENT', value: 'gpt-4o-mini' }
  { name: 'ANALYTICS_SERVICE_URL', value: 'https://${analytics.properties.defaultHostName}' }
  { name: 'ANALYTICS_API_KEY', value: '@Microsoft.KeyVault(SecretUri=${kvRef}/analytics-internal-key/)' }
  { name: 'SWAGGER_ENABLED', value: isProd ? 'false' : 'true' }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appi.properties.ConnectionString }
]

resource api 'Microsoft.Web/sites@2024-04-01' = {
  name: 'app-shipops-api-${suffix}'
  location: location
  tags: tags
  kind: 'app,linux,container'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: true // keep a WebSocket client on one instance
    virtualNetworkSubnetId: appSubnetId
    siteConfig: union(commonSiteConfig, {
      linuxFxVersion: 'DOCKER|${acr.properties.loginServer}/shipops-backend:${imageTag}'
      webSocketsEnabled: true
      healthCheckPath: '/health/ready'
      appSettings: apiSettings
    })
  }
}

// Blue/green: deploy here, warm up, then swap
resource apiStaging 'Microsoft.Web/sites/slots@2024-04-01' = {
  parent: api
  name: 'staging'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: true
    virtualNetworkSubnetId: appSubnetId
    siteConfig: union(commonSiteConfig, {
      linuxFxVersion: 'DOCKER|${acr.properties.loginServer}/shipops-backend:${imageTag}'
      webSocketsEnabled: true
      healthCheckPath: '/health/ready'
      appSettings: apiSettings
    })
  }
}

resource web 'Microsoft.Web/sites@2024-04-01' = {
  name: 'app-shipops-web-${suffix}'
  location: location
  tags: tags
  kind: 'app,linux,container'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    virtualNetworkSubnetId: appSubnetId
    siteConfig: union(commonSiteConfig, {
      linuxFxVersion: 'DOCKER|${acr.properties.loginServer}/shipops-frontend:${imageTag}'
      appSettings: [{ name: 'WEBSITES_PORT', value: '80' }]
    })
  }
}

// ---------------------------------------------------------------- private endpoints
var privateEndpoints = [
  { name: 'pe-psql', target: pg.id, group: 'postgresqlServer', zone: 0 }
  { name: 'pe-kv', target: kv.id, group: 'vault', zone: 1 }
  { name: 'pe-analytics', target: analytics.id, group: 'sites', zone: 2 }
]

resource pes 'Microsoft.Network/privateEndpoints@2024-05-01' = [for p in privateEndpoints: {
  name: '${p.name}-${env}'
  location: location
  tags: tags
  properties: {
    subnet: { id: peSubnetId }
    privateLinkServiceConnections: [{ name: p.name, properties: { privateLinkServiceId: p.target, groupIds: [p.group] } }]
  }
}]

resource peDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = [for (p, i) in privateEndpoints: {
  parent: pes[i]
  name: 'default'
  properties: { privateDnsZoneConfigs: [{ name: 'zone', properties: { privateDnsZoneId: dnsZones[p.zone].id } }] }
}]

resource peOpenAI 'Microsoft.Network/privateEndpoints@2024-05-01' = if (deployOpenAI) {
  name: 'pe-oai-${env}'
  location: location
  tags: tags
  properties: {
    subnet: { id: peSubnetId }
    privateLinkServiceConnections: [{ name: 'pe-oai', properties: { privateLinkServiceId: openai.id, groupIds: ['account'] } }]
  }
}

resource peOpenAIDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = if (deployOpenAI) {
  parent: peOpenAI
  name: 'default'
  properties: { privateDnsZoneConfigs: [{ name: 'zone', properties: { privateDnsZoneId: dnsZones[3].id } }] }
}

// ---------------------------------------------------------------- RBAC (managed identities)
var roles = {
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
  kvSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  openAiUser: '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
}
// Loop over static indexes (names must be known at deployment start); principal ids are runtime values
var principals = [api.identity.principalId, apiStaging.identity.principalId, analytics.identity.principalId, web.identity.principalId]
var siteIds = [api.id, apiStaging.id, analytics.id, web.id]

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for i in range(0, 4): {
  name: guid(acr.id, roles.acrPull, siteIds[i])
  scope: acr
  properties: { principalId: principals[i], principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.acrPull) }
}]

// api, api staging slot and analytics read secrets; the static web app needs none
resource kvRead 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for i in range(0, 3): {
  name: guid(kv.id, roles.kvSecretsUser, siteIds[i])
  scope: kv
  properties: { principalId: principals[i], principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.kvSecretsUser) }
}]

resource oaiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for i in range(0, 2): if (deployOpenAI) {
  name: guid(resourceGroup().id, 'oai', roles.openAiUser, siteIds[i])
  scope: openai
  properties: { principalId: principals[i], principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.openAiUser) }
}]

// ---------------------------------------------------------------- outputs
output acrName string = acr.name
output apiUrl string = 'https://${api.properties.defaultHostName}'
output webUrl string = 'https://${web.properties.defaultHostName}'
output keyVaultName string = kv.name
output postgresHost string = pg.properties.fullyQualifiedDomainName
