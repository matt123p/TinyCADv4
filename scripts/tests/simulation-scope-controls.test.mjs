import { test } from 'node:test';
import { runRegression } from './run-regression.mjs';

test('scope ranges use bounded 1–2–5 steps and preserve imported arbitrary scales until adjusted', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import { scopeTimeSteps, scopeVoltageSteps, scopeNextStep, scopeStepIndex, scopeQuantity } from './src/simulation/scopeControls';
    import { positiveQuantity } from './src/simulation/numbers';
    for (const [steps, unit] of [[scopeTimeSteps, 's'], [scopeVoltageSteps, 'V']]) {
      steps.forEach((value, i) => {
        assert.equal(scopeStepIndex(value, steps, unit), i);
        assert.equal(scopeNextStep(value, steps, unit, 1), steps[Math.min(i+1,steps.length-1)]);
        assert.equal(scopeNextStep(value, steps, unit, -1), steps[Math.max(i-1,0)]);
        const n=positiveQuantity(value,unit), decade=10**Math.floor(Math.log10(n));
        assert.ok([1,2,5].some(m=>Math.abs(n/decade-m)<1e-8));
      });
    }
    assert.equal(scopeNextStep('2.130787',scopeVoltageSteps,'V',1),'5V');
    assert.equal(scopeNextStep('2.130787',scopeVoltageSteps,'V',-1),'2V');
    assert.equal(scopeNextStep('0.005810419',scopeTimeSteps,'s',1),'10ms');
    assert.equal(scopeNextStep('0.005810419',scopeTimeSteps,'s',-1),'5ms');
    assert.equal(scopeQuantity(.0002,'s'),'200 µs');
    assert.equal(scopeQuantity(.1,'V'),'100 mV');
    assert.equal(scopeQuantity(1000,'Hz'),'1 kHz');
  `);
});

test('positive position moves traces up, keeps independent channels and leaves measured voltages unchanged', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import { defaultInstrument, scopeDisplay, instrumentTemplate } from './src/simulation/instruments';
    import { scopePosition, scopePositionPatch, scopeScalePatch } from './src/simulation/scopeControls';
    import { positiveQuantity, parseQuantity } from './src/simulation/numbers';
    const config=defaultInstrument('scope');
    const data={scale:'time',log:'',vectors:[{name:'time',unit:'s',real:[0,1,2,3]},{name:'A',unit:'V',real:[-1,1,-1,1]},{name:'B',unit:'V',real:[0,2,0,2]}]};
    const before=scopeDisplay(data,config);
    const moved={...config,...scopePositionPatch(config,'A',1.5)};
    assert.equal(scopePosition(moved,'A'),1.5);
    assert.equal(parseQuantity(moved.offsetA,'V'),-1.5);
    assert.equal(scopePosition(moved,'B'),0);
    assert.deepEqual(scopeDisplay(data,moved).data,before.data);
    assert.equal(instrumentTemplate(moved),instrumentTemplate(config),'position is display-only and does not alter circuit loading');
    const scaled={...moved,...scopeScalePatch(moved,'A','200mV')};
    assert.ok(Math.abs(scopePosition(scaled,'A')-1.5)<1e-12,'volts/div retains the ground marker position in divisions');
    const min=parseQuantity(scaled.offsetA,'V')-4*positiveQuantity(scaled.scaleA,'V');
    assert.ok(Math.abs((0-min)/(8*positiveQuantity(scaled.scaleA,'V'))-(.5+1.5/8))<1e-12);
    assert.equal(scaled.scaleB,config.scaleB);
    assert.equal(scaled.offsetB,config.offsetB);
    assert.deepEqual(data.vectors[1].real,[-1,1,-1,1]);
  `);
});
