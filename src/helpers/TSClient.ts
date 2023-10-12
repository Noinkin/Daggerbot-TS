interface TokenService_API {
  main:        string,
  octokit:     string,
  youtube:     string,
  mongodb_uri: string,
  redis_uri:   string
}

export default class TSClient {
  static async Token() {
    return await fetch('http://192.168.68.18/daggerbot').then(x=>x.json()) as Promise<TokenService_API>
  }
}
