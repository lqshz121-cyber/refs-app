// Synthetic credential shapes only. This corpus is shared by sender, HTTP and PG gates.
export const secretPayloads=[
  ...['token','secret','cookie','set-cookie','api-key','database_url','client_secret','access_token','authorization','raw_payload','private_key'].map(key=>({nested:{[key]:'synthetic'}})),
  ...['Bearer synthetic-access-token-123','token=synthetic','secret:synthetic','cookie=session-synthetic','database_url=postgres://synthetic',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGljLXNpZ25hdHVyZQ',
    'ya29.syntheticOAuthToken123','oauth=synthetic','sk-synthetic123456','rk-synthetic123456','pk-synthetic123456',
    'AKIAABCDEFGHIJKLMNOP','ghp_abcdefghijklmnopqrstuvwx','AIzaabcdefghijklmnopqrstuvwxyzABCDEFGHI',
    'xoxb-synthetic-12345','-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----'].map(memo=>({nested:[{memo}]}))
];
