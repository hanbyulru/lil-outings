import { refresh } from './pipeline.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const cmd = args[0];

if (cmd === 'refresh') {
  const now = val('now') ? new Date(val('now') + 'T12:00:00-08:00') : new Date();
  console.log(`Refreshing (${flag('offline') ? 'offline demo' : 'live'})…`);
  await refresh({ offline: flag('offline'), now, useLLM: !flag('no-llm'), outDir: val('out') || 'data/public' });
} else {
  console.log(`Usage:
  node src/cli.js refresh [--offline] [--no-llm] [--now=YYYY-MM-DD] [--out=dir]
  (set ANTHROPIC_API_KEY to enable Claude tagging; set LLM_MODEL to override the model)`);
}
