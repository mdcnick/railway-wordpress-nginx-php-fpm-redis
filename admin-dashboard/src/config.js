const required = [
  'CLERK_SECRET_KEY',
  'CLERK_PUBLISHABLE_KEY',
  'RAILWAY_API_TOKEN',
  'RAILWAY_PROJECT_ID',
  'MYSQL_HOST',
  'MYSQL_USER',
  'MYSQL_PASSWORD',
];

const config = {};

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
  config[key] = process.env[key];
}

config.PORT = process.env.PORT || 3000;
config.MYSQL_PORT = process.env.MYSQL_PORT || 3306;
config.DASHBOARD_DB_NAME = process.env.DASHBOARD_DB_NAME || 'wp_dashboard';
config.RAILWAY_ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID || '';
config.RAILWAY_WP_REPO = process.env.RAILWAY_WP_REPO || '';

export default config;
