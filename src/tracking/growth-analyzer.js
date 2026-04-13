/**
 * Growth velocity analysis using historical tracking data.
 * Enhances candidates with growth metrics when 3+ days of history exist.
 */

/**
 * Enhance candidates with growth analysis from historical data.
 */
function enhanceWithGrowthData(candidates, history) {
  let enhanced = 0;

  for (const candidate of candidates) {
    const histEntry = history.channels[candidate.channelId];
    if (!histEntry || !histEntry.snapshots || histEntry.snapshots.length < 3) continue;

    const snapshots = histEntry.snapshots;
    candidate.growthAnalysis = computeGrowthMetrics(snapshots, candidate);
    enhanced++;
  }

  if (enhanced > 0) {
    console.log(`Growth analysis: enhanced ${enhanced} candidates with historical data`);
  }
}

/**
 * Compute growth metrics from historical snapshots.
 */
function computeGrowthMetrics(snapshots, candidate) {
  const sorted = [...snapshots].sort((a, b) => new Date(a.date) - new Date(b.date));
  const daysTracked = sorted.length;

  // Daily subscriber growth rate
  const firstSubs = sorted[0].subscribers;
  const lastSubs = candidate.subscriberCount || sorted[sorted.length - 1].subscribers;
  const daySpan = Math.max(1, Math.floor(
    (new Date(sorted[sorted.length - 1].date) - new Date(sorted[0].date)) / 86400000
  ));
  const dailySubGrowthRate = Math.round((lastSubs - firstSubs) / daySpan);

  // Daily view growth rate
  const firstViews = sorted[0].avgViews;
  const lastViews = candidate.metrics?.averageViews || sorted[sorted.length - 1].avgViews;
  const dailyViewGrowthRate = Math.round((lastViews - firstViews) / daySpan);

  // Score trajectory (linear regression on scores)
  const scores = sorted.map(s => s.score);
  const scoreTrajectory = computeTrajectory(scores);

  // Projected subscribers 30 days out
  const projectedSubscribers30d = Math.max(0, lastSubs + (dailySubGrowthRate * 30));

  // Growth acceleration (is growth speeding up or slowing down?)
  const growthAcceleration = computeAcceleration(sorted.map(s => s.subscribers));

  return {
    daysTracked,
    dailySubGrowthRate,
    dailyViewGrowthRate,
    scoreTrajectory,
    projectedSubscribers30d,
    growthAcceleration,
  };
}

/**
 * Determine trajectory from a series of values: RISING, STABLE, or FALLING.
 * Uses simple linear regression slope.
 */
function computeTrajectory(values) {
  if (values.length < 2) return 'STABLE';

  const n = values.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  if (slope > 2) return 'RISING';
  if (slope < -2) return 'FALLING';
  return 'STABLE';
}

/**
 * Compute growth acceleration (second derivative).
 * Returns 'accelerating', 'decelerating', or 'steady'.
 */
function computeAcceleration(values) {
  if (values.length < 3) return 'steady';

  // Compute first differences (velocity)
  const diffs = [];
  for (let i = 1; i < values.length; i++) {
    diffs.push(values[i] - values[i - 1]);
  }

  // Compute second differences (acceleration)
  const accel = [];
  for (let i = 1; i < diffs.length; i++) {
    accel.push(diffs[i] - diffs[i - 1]);
  }

  const avgAccel = accel.reduce((a, b) => a + b, 0) / accel.length;

  if (avgAccel > 5) return 'accelerating';
  if (avgAccel < -5) return 'decelerating';
  return 'steady';
}

module.exports = { enhanceWithGrowthData };
