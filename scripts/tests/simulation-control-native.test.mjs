import { test } from 'node:test';
import fs from 'node:fs';
import { runRegression } from './run-regression.mjs';

test(
  'source previews match native ngspice samples and controlled sources/current probes produce expected readings',
  {
    skip:
      !fs.existsSync('build/engines/native/manifest.json') &&
      'Native runtime is not staged',
  },
  async () => {
    await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    import { spawnSync } from 'node:child_process';
    import { defaultSource, compileSource, controlTemplate } from './src/simulation/controls';
    const runtime = path.resolve('build/engines/native');
    const manifest = JSON.parse(fs.readFileSync(path.join(runtime,'manifest.json'),'utf8'));
    const base = path.resolve('build/qualification');fs.mkdirSync(base,{recursive:true});
    const directory = fs.mkdtempSync(path.join(base,'source-check-'));
    function solve(body, command) {
      const file = path.join(directory,'circuit.cir');
      fs.writeFileSync(file,'Source qualification\n'+body+'\n'+command+'\n.end\n');
      const result = spawnSync(path.join(runtime,manifest.helper),[path.join(runtime,manifest.library),file,...manifest.modules.map(m=>path.join(runtime,m))],
        {cwd:directory,encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024});
      assert.equal(result.status,0,result.stderr+' '+result.stdout);
      const events = result.stdout.trim().split('\n').map(line=>JSON.parse(line));
      assert.equal(events.at(-1).state,'complete',result.stdout);
      return { names:events.find(e=>e.type==='vectors').names, rows:events.filter(e=>e.type==='data').flatMap(e=>e.rows) };
    }
    try {
      for (const waveform of ['dc','sine','pulse','triangle','pwl','exponential','fm']) {
        const source=compileSource({...defaultSource(),waveform});
        const result=solve('V1 in 0 '+source.statement+'\nR1 in 0 1k', '.tran '+source.duration/2000+' '+source.duration);
        const time=result.names.indexOf('time'), signal=result.names.indexOf('in');
        assert.ok(time>=0 && signal>=0,waveform);
        for (const row of result.rows) assert.ok(Math.abs(row[signal]-source.value(row[time]))<1e-5,
          waveform+' at '+row[time]+': native '+row[signal]+' preview '+source.value(row[time]));
      }
      const current=compileSource({...defaultSource(),type:'current',dc:'1mA'});
      let result=solve('I1 out 0 '+current.statement+'\nR1 out 0 1k','.op');
      assert.ok(Math.abs(result.rows[0][result.names.indexOf('out')]+1)<1e-9);
      result=solve('V1 in 0 5\nVP1 in out 0\nR1 out 0 1k','.op');
      assert.ok(Math.abs(result.rows[0][result.names.indexOf('vp1#branch')]-.005)<1e-9);
      result=solve('V1 control 0 2\nE1 out 0 control 0 3\nR1 out 0 1k','.op');
      assert.ok(Math.abs(result.rows[0][result.names.indexOf('out')]-6)<1e-9);
      result=solve('V1 control 0 2\nG1 out 0 control 0 .001\nR1 out 0 1k','.op');
      assert.ok(Math.abs(result.rows[0][result.names.indexOf('out')]+2)<1e-9);
    } finally {
      fs.rmSync(directory,{recursive:true,force:true});
    }
  `);
  },
);
