// Neutral interpreted task payload; no imports, writes, network or model calls.
const [operation, ...args] = process.argv.slice(2);
if (operation === 'echo') console.log(JSON.stringify(args));
else if (operation === 'fail') { console.error('fixture failure'); process.exitCode = 7; }
else { console.error('unknown operation'); process.exitCode = 2; }
