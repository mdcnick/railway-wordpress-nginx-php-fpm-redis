import config from '../config.js';

const RAILWAY_API = 'https://backboard.railway.com/graphql/v2';

async function gql(query, variables = {}) {
  const res = await fetch(RAILWAY_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.RAILWAY_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    console.error('Railway API error:', JSON.stringify({ query: query.trim().split('\n')[0], variables, errors: json.errors }));
    throw new Error(`Railway API: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

let cachedEnvId;

export async function getEnvironmentId() {
  if (cachedEnvId) return cachedEnvId;
  if (config.RAILWAY_ENVIRONMENT_ID) {
    cachedEnvId = config.RAILWAY_ENVIRONMENT_ID;
    return cachedEnvId;
  }
  const data = await gql(`
    query ($projectId: String!) {
      project(id: $projectId) {
        environments { edges { node { id name } } }
      }
    }
  `, { projectId: config.RAILWAY_PROJECT_ID });
  const envs = data.project.environments.edges;
  const prod = envs.find(e => e.node.name === 'production') || envs[0];
  cachedEnvId = prod.node.id;
  return cachedEnvId;
}

export async function createService(name) {
  const data = await gql(`
    mutation ($input: ServiceCreateInput!) {
      serviceCreate(input: $input) { id name }
    }
  `, {
    input: {
      projectId: config.RAILWAY_PROJECT_ID,
      name,
      ...(config.RAILWAY_WP_REPO ? { source: { repo: config.RAILWAY_WP_REPO } } : {}),
    },
  });
  return data.serviceCreate;
}

export async function setServiceVariables(serviceId, variables) {
  const environmentId = await getEnvironmentId();
  await gql(`
    mutation ($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }
  `, {
    input: {
      projectId: config.RAILWAY_PROJECT_ID,
      serviceId,
      environmentId,
      variables,
    },
  });
}

export async function createVolume(serviceId, name, mountPath) {
  const environmentId = await getEnvironmentId();
  const data = await gql(`
    mutation ($input: VolumeCreateInput!) {
      volumeCreate(input: $input) { id name }
    }
  `, {
    input: {
      projectId: config.RAILWAY_PROJECT_ID,
      serviceId,
      environmentId,
      name,
      mountPath,
    },
  });
  return data.volumeCreate;
}

export async function getServiceDomain(serviceId) {
  const environmentId = await getEnvironmentId();
  const data = await gql(`
    mutation ($input: ServiceDomainCreateInput!) {
      serviceDomainCreate(input: $input) { domain }
    }
  `, {
    input: { serviceId, environmentId },
  });
  return data.serviceDomainCreate.domain;
}

export async function getServiceStatus(serviceId) {
  const data = await gql(`
    query ($serviceId: String!) {
      service(id: $serviceId) {
        deployments(first: 1, orderBy: { createdAt: DESC }) {
          edges { node { id status } }
        }
      }
    }
  `, { serviceId });
  const edges = data.service.deployments.edges;
  if (!edges.length) return 'no_deployments';
  return edges[0].node.status;
}

export async function triggerDeploy(serviceId) {
  const environmentId = await getEnvironmentId();
  await gql(`
    mutation ($serviceId: String!, $environmentId: String!) {
      serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
    }
  `, { serviceId, environmentId });
}

export async function deleteService(serviceId) {
  await gql(`
    mutation ($serviceId: String!) {
      serviceDelete(id: $serviceId)
    }
  `, { serviceId });
}

export async function deployService(serviceId, { dbName, redisPrefix, siteName }) {
  await setServiceVariables(serviceId, {
    WORDPRESS_DB_HOST: config.MYSQL_HOST,
    WORDPRESS_DB_PORT: String(config.MYSQL_PORT),
    WORDPRESS_DB_USER: config.MYSQL_USER,
    WORDPRESS_DB_PASSWORD: config.MYSQL_PASSWORD,
    WORDPRESS_DB_NAME: dbName,
    REDIS_HOST: process.env.REDIS_HOST || '',
    REDIS_PORT: process.env.REDIS_PORT || '6379',
    REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',
    WP_REDIS_PREFIX: redisPrefix,
  });

  await createVolume(serviceId, `${siteName}-volume`, '/var/www/html');
  const domain = await getServiceDomain(serviceId);

  // Trigger an actual deployment now that all configuration is in place.
  // Without this call Railway has no deployments to report, so getServiceStatus
  // returns 'no_deployments' and the site stays stuck in 'provisioning' forever.
  await triggerDeploy(serviceId);

  return { domain };
}
