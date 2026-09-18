// Human output is deliberately an allowlist. Raw API responses may contain
// service tokens, image credentials, environment variables and storage keys.
export function userSummary(data) {
  const user = data.user ?? data;
  return { id: user.id, name: user.name, mobile: user.mobile, email: user.email,
    verified: user.certAuth?.passed };
}

export function nodeSummary(data) {
  const userNode = data.userNode ?? data;
  const node = userNode.node ?? userNode;
  return { id: node.id, displayID: userNode.displayID, status: userNode.status,
    gpu: node.hardware?.gpu?.gpuName || node.hardware?.npu?.npuName,
    image: node.image?.alias || node.image?.name,
    agentId: userNode.agentID, runningTimeSec: userNode.runningTimeSec };
}

export function machineSummary(machine) {
  return { agentId: machine.agentId,
    name: machine.hardware?.gpu?.gpuName || machine.hardware?.npu?.npuName || machine.hardware?.machine?.cpuName,
    unitsAvailable: machine.unit?.available, gpuAvailable: machine.gpu?.available,
    domain: machine.domain,
    priceMillicent: machine.hardware?.priceMillicent,
    discountPriceMillicent: machine.hardware?.discountPriceMillicent };
}

export const listViews = {
  machines: machineSummary,
  hardwares: (item) => ({ id: item.id, agentId: item.agentId,
    name: item.hardware?.gpu?.gpuName || item.hardware?.machine?.cpuName,
    isAvail: item.isAvail, priceMillicent: item.hardware?.priceMillicent }),
  images: (image) => ({ id: image.id, name: image.alias || image.name,
    cached: image.cached, status: image.status, ownerType: image.ownerType }),
  userNodes: nodeSummary,
};
