import Fastify from 'fastify';

const fastify = Fastify({ logger: true });

// Health endpoint - returns 200 OK
fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// API Users endpoint - returns user list
fastify.get('/api/users', async (request, reply) => {
  return {
    users: [
      { id: 1, name: 'Alice', email: 'alice@example.com' },
      { id: 2, name: 'Bob', email: 'bob@example.com' },
      { id: 3, name: 'Charlie', email: 'charlie@example.com' }
    ]
  };
});

// API Items endpoint - returns item list
fastify.get('/api/items', async (request, reply) => {
  return {
    items: [
      { id: 1, name: 'Item One', price: 9.99 },
      { id: 2, name: 'Item Two', price: 19.99 },
      { id: 3, name: 'Item Three', price: 29.99 }
    ]
  };
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Server listening on http://localhost:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();