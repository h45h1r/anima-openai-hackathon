window.addEventListener('DOMContentLoaded', () => {
  SwaggerUIBundle({
    url: '/api/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    filter: true,
    docExpansion: 'none',
    defaultModelsExpandDepth: -1,
    displayRequestDuration: true,
    persistAuthorization: false,
    validatorUrl: null,
    queryConfigEnabled: false,
    supportedSubmitMethods: ['get', 'post', 'put', 'patch', 'delete', 'head'],
    presets: [SwaggerUIBundle.presets.apis],
    layout: 'BaseLayout',
  });
});
