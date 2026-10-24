#!/usr/bin/env node
/** Read-only approval and source/base race guard for production promotion requests. */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export function validateRequest(pr, reviews, repository, expectedMain, source, main, verified) {
  if (pr.state !== 'open' || pr.draft || pr.head?.repo?.full_name !== repository || pr.base?.repo?.full_name !== repository || pr.head.ref !== 'development' || pr.base.ref !== 'main') throw new Error('requires open non-draft same-repository development-to-main request');
  if (pr.head.sha !== source || pr.base.sha !== expectedMain || main !== expectedMain || verified && source !== verified) throw new Error('promotion source/base moved; rerun verification');
  const latest = new Map();
  for (const review of reviews) if (['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(review.state)) latest.set(review.user.login, review);
  const decisions = [...latest.values()];
  if (decisions.some(r => r.state === 'CHANGES_REQUESTED') || !decisions.some(r => r.state === 'APPROVED' && r.commit_id === source && r.user.login !== pr.user.login && ['OWNER','MEMBER','COLLABORATOR'].includes(r.author_association))) throw new Error('current source requires independent maintainer approval and no outstanding change requests');
  return source;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [number, expected, verified] = process.argv.slice(2), repository = process.env.GITHUB_REPOSITORY;
  if (!repository || !/^[1-9][0-9]*$/.test(number) || !/^[a-f0-9]{40}$/.test(expected) || verified && !/^[a-f0-9]{40}$/.test(verified)) throw new Error('usage: production-request.mjs <pr-number> <expected-main-sha> [verified-source-sha]');
  const api = endpoint => JSON.parse(execFileSync('gh',['api', 'repos/'+repository+'/'+endpoint],{encoding:'utf8'}));
  const pr = api('pulls/'+number);
  const pages = JSON.parse(execFileSync('gh',['api','--paginate','--slurp','repos/'+repository+'/pulls/'+number+'/reviews?per_page=100'],{encoding:'utf8'}));
  const source = validateRequest(pr,pages.flat(),repository,expected,api('branches/development').commit.sha,api('branches/main').commit.sha,verified);
  console.log('source_sha='+source);
}
