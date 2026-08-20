<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { TrendData } from '../types';

echarts.use([GridComponent, TooltipComponent, LineChart, CanvasRenderer]);

const props = defineProps<{ trend: TrendData; title?: string }>();

const el = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

function render() {
  if (!el.value) return;
  if (!chart) {
    chart = echarts.init(el.value);
  }
  chart.setOption({
    backgroundColor: 'transparent',
    grid: { left: 40, right: 16, top: 20, bottom: 36 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(23, 23, 23, 0.92)',
      borderColor: 'rgba(234, 179, 8, 0.3)',
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: '#e5e5e5', fontSize: 12 },
      formatter: (params: Array<{ name: string; value: number }>) => {
        const p = params[0];
        if (!p) return '';
        return `<div style="font-weight:600;margin-bottom:4px;color:#a3a3a3">${p.name}</div><div>峰值在线：<span style="color:#fbbf24;font-weight:800;font-family:monospace;font-size:14px">${p.value}</span> 人</div>`;
      },
    },
    xAxis: {
      type: 'category',
      data: props.trend.labels,
      axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.12)' } },
      axisLabel: { color: '#a3a3a3', fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: '#a3a3a3', fontSize: 11 },
      splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } },
    },
    series: [
      {
        name: props.title || '在线人数',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: props.trend.data,
        lineStyle: {
          color: '#fbbf24',
          width: 2.5,
          shadowColor: 'rgba(234, 179, 8, 0.4)',
          shadowBlur: 8,
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(234, 179, 8, 0.38)' },
            { offset: 0.6, color: 'rgba(180, 83, 9, 0.12)' },
            { offset: 1, color: 'rgba(0, 0, 0, 0)' },
          ]),
        },
      },
    ],
  });
}

function resize() {
  chart?.resize();
}

onMounted(() => {
  render();
  window.addEventListener('resize', resize);
});

watch(
  () => props.trend,
  () => render(),
  { deep: true }
);

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize);
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <div ref="el" style="width: 100%; height: 361px"></div>
</template>
