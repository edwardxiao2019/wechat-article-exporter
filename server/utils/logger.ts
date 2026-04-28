// 记录 HTTP 请求报文
export async function logRequest(requestId: string, request: Request) {
  let requestBody = '<nil>';
  if (request.body) {
    requestBody = await request.text();
  }

  const timestamp = new Date().toISOString();
  console.log(
    `[请求 ${requestId} ${timestamp}]\n` +
      `${request.method} ${request.url}\n` +
      `${[...request.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n` +
      `${requestBody}`
  );
}

// 记录 HTTP 响应报文
export async function logResponse(requestId: string, response: Response) {
  let responseBody = '';
  if (response.headers.get('Content-Type') === 'application/json') {
    responseBody = JSON.stringify(await response.json(), null, 2);
  } else {
    responseBody = await response.text();
  }
  responseBody = responseBody.length > 200 ? `${responseBody.slice(0, 200)}...` : responseBody;

  const timestamp = new Date().toISOString();
  console.log(
    `[响应 ${requestId} ${timestamp}]\n` +
      `HTTP/1.1 ${response.status} ${response.statusText}\n` +
      `${[...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n` +
      `${responseBody || '<nil>'}`
  );
}
