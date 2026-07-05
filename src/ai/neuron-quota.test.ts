import { describe, expect, it } from 'vitest';
import {
  hasNeuronQuotaRemaining,
  isNeuronQuotaError,
  isWorkersAiMetric,
  neuronQuotaStatus,
} from './neuron-quota.js';

describe('neuron-quota', () => {
  it('isWorkersAiMetric matches neuron metrics', () => {
    expect(isWorkersAiMetric({ x_BillableMetricId: 'workers_ai_neurons' })).toBe(true);
    expect(isWorkersAiMetric({ ServiceName: 'Workers AI' })).toBe(true);
    expect(isWorkersAiMetric({ ServiceName: 'R2' })).toBe(false);
  });

  it('isNeuronQuotaError detects 4006', () => {
    expect(isNeuronQuotaError('4006: daily free allocation')).toBe(true);
    expect(isNeuronQuotaError('NEURON_QUOTA_EXCEEDED')).toBe(true);
    expect(isNeuronQuotaError('network timeout')).toBe(false);
  });

  it('hasNeuronQuotaRemaining reserves headroom', () => {
    expect(hasNeuronQuotaRemaining(9000, 10000, 500)).toBe(true);
    expect(hasNeuronQuotaRemaining(9600, 10000, 500)).toBe(false);
  });

  it('neuronQuotaStatus computes remaining', () => {
    expect(neuronQuotaStatus(9500, 10000, 500)).toEqual({
      remaining: 500,
      exceeded: false,
    });
    expect(neuronQuotaStatus(9800, 10000, 500).exceeded).toBe(true);
  });
});
