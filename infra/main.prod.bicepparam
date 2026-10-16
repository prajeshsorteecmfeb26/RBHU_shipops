using './main.bicep'

param env = 'prod'
param corsOrigins = 'https://shipops.rbhu.in'
param deployOpenAI = true
param entraApiAudience = 'api://shipops-api'
param pgAdminPassword = readEnvironmentVariable('PG_ADMIN_PASSWORD', '')
