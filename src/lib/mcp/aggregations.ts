export const AGGREGATION_FUNCTIONS_LIST = ["count", "sum", "avg", "min", "max"] as const;
export type AggregationFunction = (typeof AGGREGATION_FUNCTIONS_LIST)[number];
