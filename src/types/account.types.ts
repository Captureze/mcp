/**
 * Account and usage information returned by the Captureze API.
 */
export interface Account {
  id: string;
  email: string;
  plan: string;
  captures: {
    used: number;
    limit: number;
  };
  monitors: {
    used: number;
    limit: number;
  };
}
