// Synthetic values with shapes verified against read-only MatPool responses.
// No account data, tokens, passwords, or real instance identifiers are stored.
export const machine = {
  agentId: 1,
  resourceID: 99,
  gpu: { available: 4, total: 4, max: 4 },
  cpu: { available: 16, total: 16, max: 16 },
  unit: { available: 4, total: 4, max: 4 },
  hardware: {
    gpu: { gpuIds: [0], gpuName: 'Test GPU' },
    machine: { cpuName: 'Test CPU' },
    priceMillicent: 100000,
    discountPriceMillicent: 100000,
  },
  items: [{ id: 999 }],
};

export const userNode = {
  node: { id: 12, hardware: machine.hardware, image: { id: 2, alias: 'Test image', creds: 'fixture-secret' } },
  displayID: 'opaque-request-id',
  agentID: 1,
  status: 2,
  supportQuickSave: true,
  envs: 'TOKEN=fixture-secret',
  mountInfos: [{ key: 'fixture-secret' }],
};
