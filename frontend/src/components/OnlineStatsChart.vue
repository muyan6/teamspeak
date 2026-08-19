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
      formatter: (params: Array<{ name: string; value: number }>) => {
        const p = params[0];
        if (!p) return '';
        return `${p.name}<br/>峰值在线：${p.value} 人`;
      },
    },
    xAxis: {
      type: 'category',
      data: props.trend.labels,
      axisLine: { lineStyle: { color: '#3a4157' } },
      axisLabel: { color: '#9aa3b8', fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: '#9aa3b8', fontSize: 11 },
      splitLine: { lineStyle: { color: 'rgba(42,48,68,0.6)' } },
    },
    series: [
      {
        name: props.title || '在线人数',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: props.trend.data,
        lineStyle: { color: '#f43f5e', width: 2.5 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(244,63,94,0.38)' },
            { offset: 1, color: 'rgba(244,63,94,0)' },
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
  <div ref="el" style="width: 100%; height: 260px"></div>
</template>
