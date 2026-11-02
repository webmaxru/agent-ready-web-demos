// An Arazzo 1.1 workflow: the booking flow as a sequence of OpenAPI operations.
// Agents and gateways that read Arazzo can follow it, people can read it as a recipe.

export function bookingWorkflow({ origin }) {
  return {
    arazzo: '1.1.0',
    info: {
      title: 'Book a Nordlys cabin',
      version: '1.0.0',
      summary: 'Find a cabin, confirm availability and price, then book it with an idempotency key.',
    },
    sourceDescriptions: [{ name: 'nordlysApi', url: `${origin}/openapi.json`, type: 'openapi' }],
    workflows: [
      {
        workflowId: 'bookCabin',
        summary: 'Search, check availability, book',
        inputs: {
          type: 'object',
          required: ['region', 'guests', 'checkIn', 'checkOut', 'name', 'email', 'acceptTerms', 'idempotencyKey'],
          properties: {
            region: { type: 'string' },
            guests: { type: 'integer' },
            checkIn: { type: 'string', format: 'date' },
            checkOut: { type: 'string', format: 'date' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            acceptTerms: { type: 'boolean', const: true, description: 'The user accepted the booking terms. Ask them, never assume.' },
            idempotencyKey: { type: 'string' },
          },
        },
        steps: [
          {
            stepId: 'search',
            operationId: 'searchCabins',
            parameters: [
              { name: 'region', in: 'query', value: '$inputs.region' },
              { name: 'guests', in: 'query', value: '$inputs.guests' },
              { name: 'checkIn', in: 'query', value: '$inputs.checkIn' },
              { name: 'checkOut', in: 'query', value: '$inputs.checkOut' },
            ],
            successCriteria: [{ condition: '$statusCode == 200' }, { context: '$response.body', condition: '$.total > 0', type: 'jsonpath' }],
            outputs: { slug: '$response.body#/data/0/slug' },
          },
          {
            stepId: 'availability',
            operationId: 'checkAvailability',
            parameters: [
              { name: 'slug', in: 'path', value: '$steps.search.outputs.slug' },
              { name: 'checkIn', in: 'query', value: '$inputs.checkIn' },
              { name: 'checkOut', in: 'query', value: '$inputs.checkOut' },
              { name: 'guests', in: 'query', value: '$inputs.guests' },
            ],
            successCriteria: [{ condition: '$statusCode == 200' }, { condition: '$response.body#/available == true' }],
            outputs: { total: '$response.body#/quote/total' },
          },
          {
            stepId: 'book',
            operationId: 'createBooking',
            parameters: [{ name: 'Idempotency-Key', in: 'header', value: '$inputs.idempotencyKey' }],
            requestBody: {
              contentType: 'application/json',
              payload: {
                cabin: '$steps.search.outputs.slug',
                checkIn: '$inputs.checkIn',
                checkOut: '$inputs.checkOut',
                guests: '$inputs.guests',
                name: '$inputs.name',
                email: '$inputs.email',
                acceptTerms: '$inputs.acceptTerms',
              },
            },
            successCriteria: [{ condition: '$statusCode == 201' }],
            outputs: { ref: '$response.body#/ref', total: '$response.body#/total' },
          },
        ],
        outputs: { ref: '$steps.book.outputs.ref', total: '$steps.book.outputs.total' },
      },
    ],
  };
}
