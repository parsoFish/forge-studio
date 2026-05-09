export type Edge = {
  id: string;
  fromIntersectionId: string;
  toIntersectionId: string;
  capacity: number;
  /** Priority class — used as a tiebreak when proportional shares are equal. Lower = higher priority. */
  priority: number;
};

export type Intersection = {
  id: string;
  edgesOut: Edge[];
};

/** Per-edge load distribution result. Returned in ascending edge.id order. */
export type EdgeLoad = {
  edgeId: string;
  load: number;            // [0, capacity]
};
