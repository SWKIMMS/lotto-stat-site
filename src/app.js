(function () {
  const draws = Array.isArray(window.LOTTO_HISTORY) ? window.LOTTO_HISTORY : [];
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const state = {
    mode: "balanced",
    setCount: 5,
    sampleSize: 6000,
    allowConsecutive: true,
    includeBonus: false,
    purchaseMode: true
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function ballClass(number) {
    if (number <= 10) return "ball-yellow";
    if (number <= 20) return "ball-blue";
    if (number <= 30) return "ball-red";
    if (number <= 40) return "ball-gray";
    return "ball-green";
  }

  function formatDate(dateText) {
    if (!dateText) return "-";
    return dateText.replaceAll("-", ".");
  }

  function renderBalls(numbers) {
    return numbers
      .map((number) => `<span class="ball ${ballClass(number)}">${number}</span>`)
      .join("");
  }

  function quantile(values, q) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return sorted[base + 1] === undefined
      ? sorted[base]
      : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }

  function buildStats(history, includeBonus) {
    const frequency = Array(46).fill(0);
    const bonusFrequency = Array(46).fill(0);
    const lastSeen = Array(46).fill(null);
    const pairCounts = Array.from({ length: 46 }, () => Array(46).fill(0));
    const sums = [];
    const oddHistogram = Array(7).fill(0);
    const lowHistogram = Array(7).fill(0);

    history.forEach((draw) => {
      const numbers = [...draw.numbers].sort((a, b) => a - b);
      const sum = numbers.reduce((total, number) => total + number, 0);
      const oddCount = numbers.filter((number) => number % 2 === 1).length;
      const lowCount = numbers.filter((number) => number <= 22).length;

      sums.push(sum);
      oddHistogram[oddCount] += 1;
      lowHistogram[lowCount] += 1;

      numbers.forEach((number) => {
        frequency[number] += 1;
        lastSeen[number] = draw.draw;
      });

      if (draw.bonus) {
        bonusFrequency[draw.bonus] += 1;
      }

      for (let i = 0; i < numbers.length; i += 1) {
        for (let j = i + 1; j < numbers.length; j += 1) {
          pairCounts[numbers[i]][numbers[j]] += 1;
          pairCounts[numbers[j]][numbers[i]] += 1;
        }
      }
    });

    const latest = history.at(-1);
    const latestDraw = latest?.draw ?? 0;
    const maxFrequency = Math.max(...frequency.slice(1), 1);
    const maxBonusFrequency = Math.max(...bonusFrequency.slice(1), 1);
    const overdue = Array.from({ length: 45 }, (_, index) => {
      const number = index + 1;
      return {
        number,
        gap: lastSeen[number] === null ? latestDraw : latestDraw - lastSeen[number]
      };
    });
    const maxGap = Math.max(...overdue.map((item) => item.gap), 1);

    const weightedFrequency = Array(46).fill(0);
    for (let number = 1; number <= 45; number += 1) {
      const bonusBoost = includeBonus ? (bonusFrequency[number] / maxBonusFrequency) * 0.25 : 0;
      weightedFrequency[number] = frequency[number] / maxFrequency + bonusBoost;
    }

    const averageSum = sums.reduce((total, sum) => total + sum, 0) / Math.max(sums.length, 1);
    const variance =
      sums.reduce((total, sum) => total + (sum - averageSum) ** 2, 0) / Math.max(sums.length, 1);
    const sumStd = Math.sqrt(variance);
    const sumLow = Math.round(quantile(sums, 0.15));
    const sumHigh = Math.round(quantile(sums, 0.85));

    const hot = Array.from({ length: 45 }, (_, index) => index + 1)
      .map((number) => ({ number, count: frequency[number], bonus: bonusFrequency[number] }))
      .sort((a, b) => b.count - a.count || a.number - b.number);

    const cold = [...hot].sort((a, b) => a.count - b.count || a.number - b.number);
    const overdueRank = [...overdue].sort((a, b) => b.gap - a.gap || a.number - b.number);

    const pairs = [];
    for (let a = 1; a <= 45; a += 1) {
      for (let b = a + 1; b <= 45; b += 1) {
        pairs.push({ numbers: [a, b], count: pairCounts[a][b] });
      }
    }
    pairs.sort((a, b) => b.count - a.count || a.numbers[0] - b.numbers[0]);

    return {
      latest,
      latestDraw,
      frequency,
      bonusFrequency,
      weightedFrequency,
      maxFrequency,
      lastSeen,
      overdue,
      maxGap,
      pairCounts,
      sums,
      averageSum,
      sumStd,
      sumLow,
      sumHigh,
      oddHistogram,
      lowHistogram,
      hot,
      cold,
      overdueRank,
      pairs
    };
  }

  function recentTrend(history) {
    const recent = history.slice(-80);
    const counts = Array(46).fill(0);
    recent.forEach((draw) => {
      draw.numbers.forEach((number) => {
        counts[number] += 1;
      });
    });
    const max = Math.max(...counts.slice(1), 1);
    return counts.map((count) => count / max);
  }

  function createBaseWeights(stats, history) {
    const trend = recentTrend(history);
    const weights = Array(46).fill(0);

    for (let number = 1; number <= 45; number += 1) {
      const frequencyScore = stats.weightedFrequency[number];
      const gap = stats.latestDraw - (stats.lastSeen[number] ?? 0);
      const overdueScore = clamp(gap / stats.maxGap, 0, 1);
      const trendScore = trend[number];
      const softenedFrequency = Math.sqrt(frequencyScore);
      const softenedOverdue = Math.sqrt(overdueScore);
      const softenedTrend = Math.sqrt(trendScore);
      let value;

      if (state.mode === "frequency") {
        value = 0.42 * softenedFrequency + 0.24 * softenedTrend + 0.18 * softenedOverdue;
      } else if (state.mode === "overdue") {
        value = 0.42 * softenedOverdue + 0.24 * softenedFrequency + 0.16 * softenedTrend;
      } else {
        value = 0.30 * softenedFrequency + 0.27 * softenedOverdue + 0.22 * softenedTrend;
      }

      weights[number] = Math.max(0.08, value + 0.05);
    }

    return weights;
  }

  function pickWeighted(pool, selected, baseWeights, stats) {
    const maxPair = Math.max(...stats.pairs.slice(0, 40).map((pair) => pair.count), 1);
    const entries = pool.map((number) => {
      const pairAffinity = selected.length
        ? selected.reduce((total, chosen) => total + stats.pairCounts[number][chosen] / maxPair, 0) /
          selected.length
        : 0;
      const jitter = 0.78 + Math.random() * 0.44;
      return {
        number,
        weight: baseWeights[number] * (1 + pairAffinity * 0.12) * jitter
      };
    });

    const totalWeight = entries.reduce((total, item) => total + item.weight, 0);
    let cursor = Math.random() * totalWeight;
    for (const item of entries) {
      cursor -= item.weight;
      if (cursor <= 0) return item.number;
    }
    return entries.at(-1).number;
  }

  function hasConsecutive(numbers) {
    return numbers.some((number, index) => index > 0 && number - numbers[index - 1] === 1);
  }

  function longestConsecutiveRun(numbers) {
    let longest = 1;
    let current = 1;

    for (let index = 1; index < numbers.length; index += 1) {
      if (numbers[index] - numbers[index - 1] === 1) {
        current += 1;
        longest = Math.max(longest, current);
      } else {
        current = 1;
      }
    }

    return longest;
  }

  function pairKeys(numbers) {
    const keys = [];

    for (let i = 0; i < numbers.length; i += 1) {
      for (let j = i + 1; j < numbers.length; j += 1) {
        keys.push(`${numbers[i]}-${numbers[j]}`);
      }
    }

    return keys;
  }

  function overlapCount(left, right) {
    return left.filter((number) => right.includes(number)).length;
  }

  function makeCandidate(baseWeights, stats) {
    const selected = [];
    const pool = Array.from({ length: 45 }, (_, index) => index + 1);

    while (selected.length < 6) {
      const picked = pickWeighted(pool, selected, baseWeights, stats);
      selected.push(picked);
      pool.splice(pool.indexOf(picked), 1);
    }

    return selected.sort((a, b) => a - b);
  }

  function scoreCandidate(numbers, baseWeights, stats) {
    const sum = numbers.reduce((total, number) => total + number, 0);
    const oddCount = numbers.filter((number) => number % 2 === 1).length;
    const lowCount = numbers.filter((number) => number <= 22).length;
    const range = numbers.at(-1) - numbers[0];
    const endings = new Set(numbers.map((number) => number % 10)).size;
    const hotHits = numbers.filter((number) => stats.hot.slice(0, 12).some((item) => item.number === number)).length;
    const overdueHits = numbers.filter((number) =>
      stats.overdueRank.slice(0, 12).some((item) => item.number === number)
    ).length;
    const coldHits = numbers.filter((number) => stats.cold.slice(0, 12).some((item) => item.number === number)).length;
    const topSixHits = numbers.filter((number) => stats.hot.slice(0, 6).some((item) => item.number === number)).length;
    const groupCounts = [0, 0, 0, 0, 0];
    numbers.forEach((number) => {
      groupCounts[Math.min(4, Math.floor((number - 1) / 10))] += 1;
    });
    const activeGroups = groupCounts.filter(Boolean).length;
    const maxGroupCount = Math.max(...groupCounts);
    const birthdayCount = numbers.filter((number) => number <= 31).length;
    const multiplesOfFive = numbers.filter((number) => number % 5 === 0).length;
    const runLength = longestConsecutiveRun(numbers);

    const sumScore = clamp(1 - Math.abs(sum - stats.averageSum) / Math.max(stats.sumStd * 2.1, 1), 0, 1);
    const oddScore = stats.oddHistogram[oddCount] / Math.max(...stats.oddHistogram);
    const lowScore = stats.lowHistogram[lowCount] / Math.max(...stats.lowHistogram);
    const frequencyScore = numbers.reduce((total, number) => total + baseWeights[number], 0) / 6;
    let pairScore = 0;
    let pairTotal = 0;
    const maxPair = Math.max(...stats.pairs.slice(0, 40).map((pair) => pair.count), 1);

    for (let i = 0; i < numbers.length; i += 1) {
      for (let j = i + 1; j < numbers.length; j += 1) {
        pairScore += stats.pairCounts[numbers[i]][numbers[j]] / maxPair;
        pairTotal += 1;
      }
    }

    pairScore = pairTotal ? pairScore / pairTotal : 0;
    const rangeScore = clamp(1 - Math.abs(range - 34) / 24, 0, 1);
    const endingScore = clamp(endings / 6, 0, 1);
    const groupSpreadScore = 0.62 * clamp(activeGroups / 4, 0, 1) + 0.38 * clamp(1 - Math.max(0, maxGroupCount - 2) / 4, 0, 1);
    const mixScore =
      0.34 * clamp(1 - Math.abs(hotHits - 2) / 3, 0, 1) +
      0.30 * clamp(1 - Math.abs(overdueHits - 2) / 3, 0, 1) +
      0.18 * clamp(1 - Math.abs(coldHits - 1) / 3, 0, 1) +
      0.18 * groupSpreadScore;
    const overheatPenalty = topSixHits >= 3 ? 0.12 : hotHits >= 5 ? 0.10 : 0;
    const publicPatternPenalty =
      (birthdayCount === 6 ? 0.10 : birthdayCount === 5 ? 0.06 : 0) +
      (runLength >= 4 ? 0.06 : runLength === 3 ? 0.03 : 0) +
      (multiplesOfFive >= 4 ? 0.035 : 0) +
      (maxGroupCount >= 4 ? 0.045 : 0) +
      (endings <= 3 ? 0.035 : 0);
    const consecutivePenalty = !state.allowConsecutive && hasConsecutive(numbers) ? 0.22 : 0;

    const total =
      0.22 * sumScore +
      0.15 * oddScore +
      0.12 * lowScore +
      0.14 * frequencyScore +
      0.04 * pairScore +
      0.08 * rangeScore +
      0.06 * endingScore +
      0.10 * groupSpreadScore +
      0.13 * mixScore -
      overheatPenalty -
      publicPatternPenalty -
      consecutivePenalty;

    return {
      score: clamp(total, 0, 1),
      sum,
      oddCount,
      lowCount,
      hotHits,
      overdueHits,
      coldHits,
      pairScore,
      range,
      groupSpreadScore
    };
  }

  function portfolioScore(candidate, selected, numberUse, usedPairs) {
    if (!selected.length) return candidate.score;

    const overlapPenalty = selected.reduce((total, item) => {
      const overlap = overlapCount(candidate.numbers, item.numbers);
      if (overlap >= 4) return total + 0.24;
      if (overlap === 3) return total + 0.13;
      if (overlap === 2) return total + 0.075;
      return total + overlap * 0.018;
    }, 0);
    const reusedNumberPenalty =
      candidate.numbers.reduce((total, number) => total + (numberUse.get(number) ?? 0), 0) * 0.014;
    const reusedPairPenalty = pairKeys(candidate.numbers).filter((key) => usedPairs.has(key)).length * 0.026;

    return candidate.score - overlapPenalty - reusedNumberPenalty - reusedPairPenalty;
  }

  function generateRecommendations(stats, history) {
    const baseWeights = createBaseWeights(stats, history);
    const seen = new Set();
    const scored = [];

    for (let index = 0; index < state.sampleSize; index += 1) {
      const numbers = makeCandidate(baseWeights, stats);
      if (!state.allowConsecutive && hasConsecutive(numbers)) continue;
      const key = numbers.join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      scored.push({ numbers, ...scoreCandidate(numbers, baseWeights, stats) });
    }

    scored.sort((a, b) => b.score - a.score);

    const selected = [];
    const selectedKeys = new Set();
    const numberUse = new Map();
    const usedPairs = new Set();
    const candidatePool = scored.slice(0, Math.max(280, state.setCount * 140));

    while (selected.length < state.setCount && candidatePool.length) {
      let bestIndex = 0;
      let bestScore = -Infinity;

      candidatePool.forEach((candidate, index) => {
        const key = candidate.numbers.join("-");
        if (selectedKeys.has(key)) return;
        const adjustedScore = portfolioScore(candidate, selected, numberUse, usedPairs);
        if (adjustedScore > bestScore) {
          bestScore = adjustedScore;
          bestIndex = index;
        }
      });

      const [picked] = candidatePool.splice(bestIndex, 1);
      selected.push(picked);
      selectedKeys.add(picked.numbers.join("-"));
      picked.numbers.forEach((number) => {
        numberUse.set(number, (numberUse.get(number) ?? 0) + 1);
      });
      pairKeys(picked.numbers).forEach((key) => usedPairs.add(key));
    }

    return selected;
  }

  function renderSummary(stats) {
    $("#latest-draw").textContent = stats.latest ? `${stats.latest.draw}회` : "-";
    $("#latest-date").textContent = formatDate(stats.latest?.date);
    $("#draw-count").textContent = `${draws.length.toLocaleString("ko-KR")}회`;
    $("#average-sum").textContent = Math.round(stats.averageSum).toString();
    $("#sum-band").textContent = `권장 합계 ${stats.sumLow}~${stats.sumHigh}`;
    $("#top-number").innerHTML = renderBalls([stats.hot[0]?.number ?? 0]);
    $("#top-number-count").textContent = `${stats.hot[0]?.count ?? 0}회 출현`;
    $("#cold-number").innerHTML = renderBalls([stats.overdueRank[0]?.number ?? 0]);
    $("#cold-number-gap").textContent = `${stats.overdueRank[0]?.gap ?? 0}회 미출현`;
  }

  function renderFrequency(stats) {
    const chart = $("#frequency-chart");
    chart.innerHTML = "";

    for (let number = 1; number <= 45; number += 1) {
      const height = 18 + (stats.frequency[number] / stats.maxFrequency) * 142;
      const bar = document.createElement("div");
      bar.className = "freq-bar";
      bar.title = `${number}번 ${stats.frequency[number]}회 출현`;
      bar.innerHTML = `
        <span class="freq-fill" style="height:${height}px"></span>
        <span class="freq-label">${number}</span>
      `;
      chart.appendChild(bar);
    }
  }

  function renderNumberList(selector, items, valueFormatter) {
    const list = $(selector);
    list.innerHTML = items
      .map(
        (item) => `
          <div class="number-chip">
            ${renderBalls([item.number])}
            <small>${valueFormatter(item)}</small>
          </div>
        `
      )
      .join("");
  }

  function renderPairs(stats) {
    $("#pair-list").innerHTML = stats.pairs
      .slice(0, 10)
      .map(
        (pair, index) => `
          <div class="pair-row">
            <small>${index + 1}</small>
            <div class="balls">${renderBalls(pair.numbers)}</div>
            <strong>${pair.count}회</strong>
          </div>
        `
      )
      .join("");
  }

  function renderRecommendations(items) {
    const container = $("#recommendations");
    if (!items.length) {
      container.innerHTML = `<div class="recommendation-card">조건에 맞는 조합이 부족합니다.</div>`;
      return;
    }

    container.innerHTML = items
      .map((item, index) => {
        const oddEven = `${item.oddCount}:${6 - item.oddCount}`;
        const lowHigh = `${item.lowCount}:${6 - item.lowCount}`;
        const score = Math.round(item.score * 100);

        return `
          <article class="recommendation-card">
            <div class="recommendation-top">
              <span class="rank">${index + 1}</span>
              <div class="balls">${renderBalls(item.numbers)}</div>
              <div class="score">
                <strong>${score}</strong>
                <span>점수</span>
              </div>
            </div>
            <div class="recommendation-meta">
              <div class="meta-item">
                <span>합계</span>
                <strong>${item.sum}</strong>
              </div>
              <div class="meta-item">
                <span>홀짝</span>
                <strong>${oddEven}</strong>
              </div>
              <div class="meta-item">
                <span>저고</span>
                <strong>${lowHigh}</strong>
              </div>
              <div class="meta-item">
                <span>패턴</span>
                <strong>인기 ${item.hotHits} · 공백 ${item.overdueHits}</strong>
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function syncControls() {
    $("#strategy-note").textContent = "5조합";
    $("#purchase-mode").setAttribute("aria-pressed", state.purchaseMode ? "true" : "false");
  }

  function render() {
    if (!draws.length) {
      $("#recommendations").innerHTML = `<div class="recommendation-card">데이터 파일을 불러오지 못했습니다.</div>`;
      return;
    }

    const stats = buildStats(draws, state.includeBonus);
    const recommendations = generateRecommendations(stats, draws);
    syncControls();
    renderSummary(stats);
    renderFrequency(stats);
    renderNumberList("#hot-list", stats.hot.slice(0, 10), (item) => `${item.count}회`);
    renderNumberList("#overdue-list", stats.overdueRank.slice(0, 10), (item) => `${item.gap}회 공백`);
    renderPairs(stats);
    renderRecommendations(recommendations);
  }

  function bindEvents() {
    $("#purchase-mode").addEventListener("click", () => {
      state.mode = "balanced";
      state.setCount = 5;
      state.sampleSize = 6000;
      state.allowConsecutive = true;
      state.includeBonus = false;
      state.purchaseMode = true;
      render();
    });
  }

  bindEvents();
  render();
})();
