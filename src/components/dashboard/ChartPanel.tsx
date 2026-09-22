import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  categoryColor,
  formatAxisNumber,
  formatChartValue,
  type ChartDatum,
  type DashboardChart as DashboardChartModel,
} from '../../lib/dashboard'
import {
  CHART_AXIS,
  CHART_CURSOR_FILL,
  CHART_CURSOR_LINE,
  CHART_GRID,
  CHART_TICK,
  CHART_TOOLTIP_FALLBACK,
} from '../../lib/dashboard/palette'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import styles from './ChartPanel.module.css'

type ChartPanelProps = {
  chart: DashboardChartModel
  index: number
}

const SLOT_TITLE: Record<DashboardChartModel['slot'], string> = {
  overview: 'Business overview',
  trend: 'Trends / Performance',
  breakdown: 'Breakdown',
}

type RechartsRow = Record<string, string | number>

function toRechartsData(data: ChartDatum[]): RechartsRow[] {
  return data.map((datum) => ({
    label: datum.label,
    ...datum.values,
  }))
}

type TooltipEntry = {
  name?: string | number
  value?: string | number
  color?: string
}

function ChartTooltip({
  active,
  label,
  payload,
  unit,
  currencySymbol,
}: {
  active?: boolean
  label?: string | number
  payload?: TooltipEntry[]
  unit: DashboardChartModel['unit']
  currencySymbol: string | null
}) {
  if (!active || !payload || payload.length === 0) {
    return null
  }

  const heading = label === undefined || label === '' ? null : String(label)

  return (
    <div className={styles.tooltip}>
      {heading ? <p className={styles.tooltipLabel}>{heading}</p> : null}
      <ul className={styles.tooltipList}>
        {payload.map((entry, index) => (
          <li key={`${entry.name ?? index}`}>
            <span
              className={styles.swatch}
              style={{ background: entry.color ?? CHART_TOOLTIP_FALLBACK }}
            />
            <span>{String(entry.name ?? '')}</span>
            <strong>
              {formatChartValue(Number(entry.value ?? 0), unit, currencySymbol)}
            </strong>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CartesianChart({
  chart,
  animate,
}: {
  chart: DashboardChartModel
  animate: boolean
}) {
  const data = toRechartsData(chart.data)
  const showLegend = chart.series.length > 1
  const angled = chart.kind === 'bar' && chart.data.length > 6
  const colorByCategory = chart.kind === 'bar' && chart.series.length === 1
  const tooltip = (
    <Tooltip
      cursor={
        chart.kind === 'line'
          ? { stroke: CHART_CURSOR_LINE }
          : { fill: CHART_CURSOR_FILL }
      }
      content={<ChartTooltip unit={chart.unit} currencySymbol={chart.currencySymbol} />}
    />
  )

  if (chart.kind === 'line') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid stroke={CHART_GRID} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: CHART_TICK, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: CHART_AXIS }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: CHART_TICK, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={formatAxisNumber}
          />
          {tooltip}
          {showLegend ? (
            <Legend
              verticalAlign="top"
              align="right"
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, color: CHART_TICK, paddingBottom: 8 }}
            />
          ) : null}
          {chart.series.map((series) => (
            <Line
              key={series.key}
              type="monotone"
              dataKey={series.key}
              name={series.name}
              stroke={series.color}
              strokeWidth={2.5}
              dot={{ r: 3, strokeWidth: 0, fill: series.color }}
              activeDot={{ r: 5.5, strokeWidth: 2, stroke: '#ffffff' }}
              isAnimationActive={animate}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
        <CartesianGrid stroke={CHART_GRID} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: CHART_TICK, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: CHART_AXIS }}
          interval={angled ? 0 : 'preserveStartEnd'}
          angle={angled ? -28 : 0}
          textAnchor={angled ? 'end' : 'middle'}
          height={angled ? 56 : 32}
        />
        <YAxis
          tick={{ fill: CHART_TICK, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={formatAxisNumber}
        />
        {tooltip}
        {showLegend ? (
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, color: CHART_TICK, paddingBottom: 8 }}
          />
        ) : null}
        {chart.series.map((series) => (
          <Bar
            key={series.key}
            dataKey={series.key}
            name={series.name}
            fill={series.color}
            radius={[5, 5, 0, 0]}
            maxBarSize={48}
            isAnimationActive={animate}
          >
            {colorByCategory
              ? chart.data.map((datum, index) => (
                  <Cell key={`${datum.label}-${index}`} fill={categoryColor(datum.label, index)} />
                ))
              : null}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function DonutChart({
  chart,
  animate,
  compact,
}: {
  chart: DashboardChartModel
  animate: boolean
  compact: boolean
}) {
  const data = chart.data.map((datum, index) => ({
    name: datum.label,
    value: Object.values(datum.values)[0] ?? 0,
    color: chart.series[index]?.color ?? categoryColor(datum.label, index),
  }))
  const total = data.reduce((sum, entry) => sum + entry.value, 0)

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={compact ? 56 : 74}
          outerRadius={compact ? 82 : 104}
          paddingAngle={3}
          stroke="#ffffff"
          strokeWidth={2}
          isAnimationActive={animate}
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          content={<ChartTooltip unit={chart.unit} currencySymbol={chart.currencySymbol} />}
        />
        <Legend
          verticalAlign={compact ? 'bottom' : 'middle'}
          align={compact ? 'center' : 'right'}
          layout={compact ? 'horizontal' : 'vertical'}
          iconType="circle"
          iconSize={8}
          formatter={(name) => {
            const entry = data.find((item) => item.name === name)
            const percent = total > 0 && entry ? Math.round((entry.value / total) * 100) : 0
            return `${String(name)}  ${percent}%`
          }}
          wrapperStyle={{
            fontSize: 12,
            color: CHART_TICK,
            lineHeight: compact ? '18px' : '22px',
            maxWidth: compact ? '100%' : 200,
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

export function ChartPanel({ chart, index }: ChartPanelProps) {
  const reduceMotion = usePrefersReducedMotion()
  const compact = useMediaQuery('(max-width: 720px)')

  return (
    <section
      className={styles.panel}
      style={{ animationDelay: `${180 + index * 90}ms` }}
      aria-label={SLOT_TITLE[chart.slot]}
    >
      <header className={styles.head}>
        <p className={styles.kicker}>{SLOT_TITLE[chart.slot]}</p>
        <h2 className={styles.title}>{chart.title}</h2>
        <p className={styles.description}>{chart.description}</p>
      </header>
      <div className={styles.chart} data-kind={chart.kind} data-compact={compact ? 'true' : 'false'}>
        {chart.kind === 'donut' ? (
          <DonutChart chart={chart} animate={!reduceMotion} compact={compact} />
        ) : (
          <CartesianChart chart={chart} animate={!reduceMotion} />
        )}
      </div>
    </section>
  )
}
