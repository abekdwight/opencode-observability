type MockResponse = {
  body: string;
  statusCode: number;
  send: (payload: string) => MockResponse;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

export function createMockResponse(): MockResponse {
  return {
    body: "",
    statusCode: 200,
    send(payload: string) {
      this.body = payload;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = JSON.stringify(payload);
      return this;
    },
  };
}
