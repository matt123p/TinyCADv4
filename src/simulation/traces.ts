import { ResultData, ResultVector } from './contracts';

export interface TraceDefinition {
  name: string;
  operation: 'subtract' | 'divide' | 'multiply';
  left: string;
  right: string;
}

export function deriveTraces(
  data: ResultData,
  definitions: TraceDefinition[],
): { data: ResultData; errors: string[] } {
  const vectors = [...data.vectors],
    errors: string[] = [];
  const count = vectors[0]?.real.length || 0;
  const zero: ResultVector = {
    name: '0',
    unit: 'V',
    real: Array(count).fill(0),
  };
  for (const trace of definitions) {
    const left =
      trace.left === '0' ? zero : vectors.find((v) => v.name === trace.left);
    const right =
      trace.right === '0' ? zero : vectors.find((v) => v.name === trace.right);
    if (
      !trace.name ||
      vectors.some((v) => v.name === trace.name) ||
      !left ||
      !right ||
      left.real.length !== right.real.length
    ) {
      errors.push(
        `Trace ${trace.name}: choose two compatible signals and a unique name.`,
      );
      continue;
    }
    if (trace.operation === 'subtract' && left.unit !== right.unit) {
      errors.push(`Trace ${trace.name}: subtraction needs matching units.`);
      continue;
    }
    const unit =
      trace.operation === 'subtract'
        ? left.unit
        : trace.operation === 'divide'
        ? `${left.unit}/${right.unit}`
        : [left.unit, right.unit].sort().join('*') === 'A*V'
        ? 'W'
        : `${left.unit}*${right.unit}`;
    const result: ResultVector = {
      name: trace.name,
      unit,
      real: [],
      imaginary: [],
    };
    let invalid = false;
    for (let i = 0; i < count; i++) {
      const a = left.real[i],
        b = left.imaginary?.[i] || 0,
        c = right.real[i],
        d = right.imaginary?.[i] || 0;
      const denominator = c * c + d * d;
      const r =
        trace.operation === 'subtract'
          ? a - c
          : trace.operation === 'multiply'
          ? a * c - b * d
          : (a * c + b * d) / denominator;
      const im =
        trace.operation === 'subtract'
          ? b - d
          : trace.operation === 'multiply'
          ? a * d + b * c
          : (b * c - a * d) / denominator;
      if (!Number.isFinite(r) || !Number.isFinite(im)) {
        invalid = true;
        break;
      }
      result.real.push(r);
      result.imaginary.push(im);
    }
    if (invalid)
      errors.push(
        `Trace ${trace.name}: undefined result (check division by zero).`,
      );
    else vectors.push(result);
  }
  return { data: { ...data, vectors }, errors };
}
