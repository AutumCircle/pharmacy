const https = require('https');

https.get('https://2y9rv4j811.execute-api.eu-central-1.amazonaws.com/prod/api/query', (res) => {
  console.log('Status Code:', res.statusCode);
}).on('error', (e) => {
  console.error('Error:', e);
});
