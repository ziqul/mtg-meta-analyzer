<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		Chart,
		BubbleController,
		LinearScale,
		PointElement,
		Tooltip,
		Legend,
	} from 'chart.js';
	import type { ArchetypeStats } from '../types/metagame';
	import { archetypeCardMap } from '../stores/tournaments';
	import { cardImageIndex, lookupCardImage } from '../stores/card-images';
	import { createArchetypeArtLoader } from '../utils/archetype-art';
	import ArchetypeLegendIcon from './ArchetypeLegendIcon.svelte';

	Chart.register(BubbleController, LinearScale, PointElement, Tooltip, Legend);

	let { stats }: { stats: ArchetypeStats[] } = $props();

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;
	/** Archetype of the legend label that the user selected, if any. */
	let selectedName: string | null = $state(null);

	/** Card art for chart bubbles (plugin + tooltip artist credit). */
	const archetypeArt = createArchetypeArtLoader(
		(name) => $archetypeCardMap.get(name),
		() => chart?.update('none'),
		2.5,
	);

	const OTHER_COLOR = '#555555';

	const COLORS = [
		'#2563eb', '#e11d48', '#16a34a', '#ea580c', '#7c3aed',
		'#0891b2', '#ca8a04', '#be185d', '#059669', '#d97706',
		'#6366f1', '#dc2626', '#65a30d', '#0d9488', '#a855f7',
	];

	/** Reference line plugin: draws a horizontal dashed line at 50% winrate. */
	const refLinePlugin = {
		id: 'refLine',
		afterDraw(chart: Chart) {
			const yScale = chart.scales.y;
			const ctx = chart.ctx;
			const y = yScale.getPixelForValue(50);
			ctx.save();
			ctx.strokeStyle = '#9ca3af';
			ctx.lineWidth = 1;
			ctx.setLineDash([6, 4]);
			ctx.beginPath();
			ctx.moveTo(chart.chartArea.left, y);
			ctx.lineTo(chart.chartArea.right, y);
			ctx.stroke();
			ctx.restore();
		},
	};

	function buildChart() {
		if (chart) chart.destroy();
		// The old chart is gone, so no bubble can stay selected.
		selectedName = null;

		const filtered = stats.filter((s) => isOnChart(s));
		if (filtered.length === 0) return;

		// Start loading images for all visible archetypes
		void archetypeArt.load(filtered.map((s) => s.name));

		const maxMatches = Math.max(...filtered.map((s) => s.totalMatches), 1);

		const data = filtered.map((s, i) => ({
			x: s.metagameShare * 100,
			y: (s.adjustedWinrate ?? s.overallWinrate) * 100,
			r: 6 + (s.totalMatches / maxMatches) * 20,
			label: s.name,
			raw: s,
		}));

		chart = new Chart(canvas, {
			type: 'bubble',
			data: {
				datasets: data.map((d, i) => {
					const isOther = d.label === 'Other';
					const color = isOther ? OTHER_COLOR : COLORS[i % COLORS.length];
					return {
						label: d.label,
						data: [{ x: d.x, y: d.y, r: d.r }],
						// Colored fill always — card art plugin draws on top when image loads
						backgroundColor: color + 'bb',
						borderColor: color,
						borderWidth: 2,
						hoverBorderWidth: 3,
						hoverBorderColor: '#fff',
						// Store archetype stats for tooltip
						metadata: d.raw,
					};
				}),
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				onHover: handleChartHover,
				scales: {
					x: {
						title: { display: true, text: 'Metagame Share (%)', font: { size: 13 } },
						min: 0,
						ticks: { callback: (v) => v + '%' },
						grid: { color: '#f0f0f0' },
					},
					y: {
						title: { display: true, text: 'Win Rate (%)', font: { size: 13 } },
						min: Math.max(0, Math.floor(Math.min(...data.map((d) => d.y)) / 5) * 5 - 5),
						max: Math.min(100, Math.ceil(Math.max(...data.map((d) => d.y)) / 5) * 5 + 5),
						ticks: {
							callback: (v) => v + '%',
							stepSize: 5,
						},
						grid: { color: '#f0f0f0' },
					},
				},
				plugins: {
					legend: { display: false },
					tooltip: {
						callbacks: {
							label(ctx) {
								const ds = ctx.dataset as any;
								const s = ds.metadata as ArchetypeStats;
								return [
									ds.label,
									`Share: ${(s.metagameShare * 100).toFixed(1)}%`,
									`Win rate: ${((s.adjustedWinrate ?? s.overallWinrate) * 100).toFixed(1)}%${s.adjustedWinrate !== undefined ? ` (raw: ${(s.overallWinrate * 100).toFixed(1)}%)` : ''}`,
									`Players: ${s.playerCount}`,
									`Matches: ${s.totalMatches}`,
								];
							},
							// Scryfall imagery guideline: art crops must credit the artist
							footer: archetypeArt.tooltipFooter,
						},
						footerFont: { weight: 'normal', size: 10 },
					},
				},
			},
			plugins: [refLinePlugin, archetypeArt.plugin],
		});
	}

	/** True when the archetype has a bubble, and thus a label to click. */
	function isOnChart(s: ArchetypeStats): boolean {
		if (s.name === 'Unknown' || s.name === 'Other') {
			return false;
		}
		return s.totalMatches > 0;
	}

	/**
	 * The pointer on the canvas gives Chart.js its own hover, which replaces a
	 * selection made from a label. The highlighted label must follow. Chart.js
	 * calls this for each move of the pointer over the canvas.
	 */
	function handleChartHover(): void {
		if (selectedName !== null) {
			selectedName = null;
		}
	}

	/**
	 * Shows a bubble as if the pointer were on it. Chart.js holds the active
	 * elements of the chart and of the tooltip in two separate places, so both
	 * get the same element. A second click on the same label clears it.
	 */
	function selectArchetype(name: string): void {
		if (!chart) {
			return;
		}
		if (selectedName === name) {
			clearSelection();
			return;
		}

		const datasetIndex = chart.data.datasets.findIndex((ds) => ds.label === name);
		if (datasetIndex === -1) {
			return;
		}
		const bubble = chart.getDatasetMeta(datasetIndex).data[0];
		if (!bubble) {
			return;
		}

		const active = [{ datasetIndex, index: 0 }];
		chart.setActiveElements(active);
		chart.tooltip?.setActiveElements(active, { x: bubble.x, y: bubble.y });
		chart.update();
		selectedName = name;
	}

	function clearSelection(): void {
		selectedName = null;
		if (!chart) {
			return;
		}
		chart.setActiveElements([]);
		chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
		chart.update();
	}

	/** Bubble and legend colour of one archetype. */
	function legendColor(s: ArchetypeStats, index: number): string {
		if (s.name === 'Other') {
			return OTHER_COLOR;
		}
		return COLORS[index % COLORS.length];
	}

	onMount(() => {
		buildChart();
	});

	onDestroy(() => {
		chart?.destroy();
		// Null out so in-flight image onload callbacks don't update a destroyed chart
		chart = null;
	});

	// Rebuild chart when stats change
	$effect(() => {
		// Read stats to track the dependency
		void stats.length;
		if (canvas) buildChart();
	});
</script>

<div class="chart-container">
	<canvas bind:this={canvas} data-testid="scatter-canvas"></canvas>
</div>

<div class="legend">
	{#each stats.filter((s) => s.name !== 'Unknown' && s.totalMatches > 0) as s, i}
		{@const art = lookupCardImage($cardImageIndex, $archetypeCardMap.get(s.name))}
		{@const color = legendColor(s, i)}
		{#if isOnChart(s)}
			<button
				type="button"
				class="legend-item legend-button"
				class:selected={selectedName === s.name}
				aria-pressed={selectedName === s.name}
				onclick={() => selectArchetype(s.name)}
			>
				<ArchetypeLegendIcon {art} name={s.name} {color} />
				{s.name}
			</button>
		{:else}
			<span class="legend-item">
				<ArchetypeLegendIcon {art} name={s.name} {color} />
				{s.name}
			</span>
		{/if}
	{/each}
</div>

<style>
	.chart-container {
		position: relative;
		height: 380px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: 1rem;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 0.75rem;
		font-size: 0.8rem;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.15rem 0.35rem;
		border: 1px solid transparent;
		border-radius: var(--radius);
	}

	/* Reset the button, so a clickable label looks like a plain label. */
	.legend-button {
		background: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.legend-button:hover {
		border-color: var(--color-border);
	}

	.legend-button.selected {
		border-color: var(--color-accent);
		background: var(--color-surface);
	}

</style>
