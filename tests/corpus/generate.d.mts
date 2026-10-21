export const OUT_DIR: string;
export const FAKE_SSN: string;
export const ENCRYPTED_PASSWORDS: { user: string; owner: string };
export const SSN_LAYOUT: {
  keepText: string;
  formField: { name: string; rect: { x: number; y: number; width: number; height: number } };
};
export function generateCorpus(opts?: { force?: boolean }): Promise<string[]>;
