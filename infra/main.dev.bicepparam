using './main.bicep'

param env = 'dev'
param imageTag = 'latest'
param corsOrigins = 'https://app-shipops-web-dev.azurewebsites.net'
param deployOpenAI = true
// Supply at deploy time:  -p pgAdminPassword=<value>   (or read it from Key Vault with getSecret())
param pgAdminPassword = readEnvironmentVariable('PG_ADMIN_PASSWORD', '')
