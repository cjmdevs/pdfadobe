// A throwaway signing identity for tests: a WebCrypto key made at test time and a
// self-signed certificate built with pkijs. Nothing is stored in the repo.
import type { webcrypto } from "node:crypto";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import type { CertSigner } from "../../src/engine/sign";

export interface TestIdentity {
  signer: CertSigner;
  certDer: Uint8Array;
  privateKey: webcrypto.CryptoKey;
}

export async function testIdentity(
  cn = "PDF Workbench Test Signer",
  kind: "rsa" | "ec" = "rsa",
): Promise<TestIdentity> {
  const alg =
    kind === "rsa"
      ? {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        }
      : { name: "ECDSA", namedCurve: "P-256" };
  const keys = (await crypto.subtle.generateKey(alg, true, [
    "sign",
    "verify",
  ])) as webcrypto.CryptoKeyPair;
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: Math.floor(Math.random() * 1e9) + 1 });
  const name = () => [
    new pkijs.AttributeTypeAndValue({
      type: "2.5.4.3",
      value: new asn1js.Utf8String({ value: cn }),
    }),
  ];
  cert.issuer.typesAndValues = name();
  cert.subject.typesAndValues = name();
  cert.notBefore.value = new Date(Date.now() - 86400000);
  cert.notAfter.value = new Date(Date.now() + 5 * 365 * 86400000);
  // keyUsage: digitalSignature + nonRepudiation.
  const ku = new asn1js.BitString({ valueHex: new Uint8Array([0xc0]).buffer, unusedBits: 6 });
  cert.extensions = [
    new pkijs.Extension({
      extnID: "2.5.29.15",
      critical: true,
      extnValue: ku.toBER(),
      parsedValue: ku,
    }),
  ];
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  await cert.sign(keys.privateKey, "SHA-256");
  const certDer = new Uint8Array(cert.toSchema(true).toBER());
  const signAlg =
    kind === "rsa" ? { name: "RSASSA-PKCS1-v1_5" } : { name: "ECDSA", hash: "SHA-256" };
  return {
    certDer,
    privateKey: keys.privateKey,
    signer: {
      certificates: [certDer],
      async sign(data) {
        const copy = data.slice();
        return new Uint8Array(await crypto.subtle.sign(signAlg, keys.privateKey, copy));
      },
    },
  };
}
