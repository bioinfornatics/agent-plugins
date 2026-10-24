import { createHash } from "node:crypto";
import { resolve } from "node:path";

/** Canonical durable identity shared by scalar full-eval and matrix preclaims. */
export function evaluationCampaignId(input:{skill:string;workspace:string;evalSet:string;baseline:"old_skill"|"without_skill";decisionPolicy:"fixed"|"adaptive"}):string {
  const framed=[resolve(input.skill),resolve(input.workspace),resolve(input.evalSet),input.baseline,input.decisionPolicy]
    .map(value=>Buffer.from(value,"utf8"));
  const hash=createHash("sha256");
  for(const value of framed){const length=Buffer.alloc(8);length.writeBigUInt64BE(BigInt(value.length));hash.update(length).update(value);}
  return hash.digest("hex").slice(0,24);
}
