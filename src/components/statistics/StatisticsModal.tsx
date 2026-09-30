import { useMemo, useState } from 'react';
import type { Conversation } from '../../types';
import { usageStatistics, type StatsPeriod, type TimelinePoint } from '../../lib/statistics';
import { ChartIcon, XIcon } from '../ui/Icons';
import { Segmented } from '../ui/Segmented';

interface Props {
  conversations: Conversation[];
  onClose: () => void;
}

const PERIODS: Array<{ value: StatsPeriod; label: string }> = [
  { value: 'today', label: 'Aujourd’hui' },
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
  { value: 'all', label: 'Tout' },
];

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

function num(value?: number) {
  return nf.format(value || 0);
}

function duration(ms?: number) {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} min ${rest} s`;
}

function cost(value: number, known: number) {
  if (!known) return '—';
  if (value === 0) return '0 $';
  return `${value < 0.01 ? value.toFixed(4) : value.toFixed(2)} $`;
}

function sampleLabels(points: TimelinePoint[]) {
  if (points.length <= 6) return points.map((p, i) => ({ i, label: p.shortLabel }));
  const indexes = new Set([0, Math.floor((points.length - 1) * .25), Math.floor((points.length - 1) * .5), Math.floor((points.length - 1) * .75), points.length - 1]);
  return [...indexes].sort((a, b) => a - b).map(i => ({ i, label: points[i].shortLabel }));
}

function polyline(points: TimelinePoint[], value: (point: TimelinePoint) => number, max: number) {
  if (!points.length) return '';
  return points.map((point, i) => {
    const x = points.length === 1 ? 50 : (i / (points.length - 1)) * 100;
    const y = 31 - (value(point) / Math.max(1, max)) * 26;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

function ActivityChart({ points }: { points: TimelinePoint[] }) {
  const max = Math.max(1, ...points.flatMap(p => [p.requests, p.conversations]));
  const requestLine = polyline(points, p => p.requests, max);
  const conversationLine = polyline(points, p => p.conversations, max);
  const labels = sampleLabels(points);
  const totalConversations = points.reduce((n, p) => n + p.conversations, 0);

  return (
    <div className="stats-chart-card">
      <div className="stats-chart-head">
        <div>
          <h3>Activité dans le temps</h3>
          <p>Nombre de requêtes et conversations actives par période</p>
        </div>
        <div className="chart-legend">
          <span><i className="legend-dot requests" />Requêtes</span>
          <span><i className="legend-dot conversations" />Conversations</span>
        </div>
      </div>
      <div className="line-chart" aria-label={`${points.reduce((n, p) => n + p.requests, 0)} requêtes, ${totalConversations} conversations actives cumulées`}>
        <svg viewBox="0 0 100 34" preserveAspectRatio="none" role="img">
          <line className="chart-grid" x1="0" y1="31" x2="100" y2="31" />
          <line className="chart-grid" x1="0" y1="18" x2="100" y2="18" />
          <line className="chart-grid" x1="0" y1="5" x2="100" y2="5" />
          {points.length > 0 && <polyline className="chart-line conversations" points={conversationLine} />}
          {points.length > 0 && <polyline className="chart-line requests" points={requestLine} />}
        </svg>
        <div className="chart-axis-labels">
          {labels.map(({ i, label }) => (
            <span key={i} style={{ left: `${points.length === 1 ? 50 : (i / (points.length - 1)) * 100}%` }}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function TokenChart({ points }: { points: TimelinePoint[] }) {
  const max = Math.max(1, ...points.map(p => p.tokens));
  const labels = sampleLabels(points);
  return (
    <div className="stats-chart-card">
      <div className="stats-chart-head">
        <div>
          <h3>Tokens dans le temps</h3>
          <p>Volume total de tokens consommés à chaque période</p>
        </div>
        <strong className="chart-total">{num(points.reduce((n, p) => n + p.tokens, 0))}</strong>
      </div>
      <div className="bar-time-chart" aria-label="Tokens dans le temps">
        <div className="bar-time-bars">
          {points.map(point => (
            <div className="bar-time-slot" key={point.key} title={`${point.label} · ${num(point.tokens)} tokens · ${point.requests} requête(s)`}>
              <div className="bar-time-value" style={{ height: `${Math.max(point.tokens ? 4 : 0, (point.tokens / max) * 100)}%` }} />
            </div>
          ))}
        </div>
        <div className="chart-axis-labels">
          {labels.map(({ i, label }) => (
            <span key={i} style={{ left: `${points.length === 1 ? 50 : (i / (points.length - 1)) * 100}%` }}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ModelUsageChart({ models }: { models: ReturnType<typeof usageStatistics>['byModel'] }) {
  const top = [...models].sort((a, b) => b.requests - a.requests || b.totalTokens - a.totalTokens).slice(0, 8);
  const max = Math.max(1, ...top.map(m => m.requests));

  return (
    <div className="stats-chart-card model-usage-card">
      <div className="stats-chart-head">
        <div>
          <h3>Modèles les plus utilisés</h3>
          <p>Classement par nombre de requêtes</p>
        </div>
        <span className="chart-muted">{top.length ? `Top ${top.length}` : 'Aucune donnée'}</span>
      </div>
      <div className="model-usage-chart">
        {top.map((model, index) => (
          <div className="model-usage-item" key={model.key}>
            <div className="model-usage-meta">
              <span className="model-rank">{index + 1}</span>
              <div className="model-usage-name">
                <strong>{model.label}</strong>
                <span>{model.providerLabel}</span>
              </div>
              <div className="model-usage-value">
                <strong>{num(model.requests)}</strong>
                <span>{num(model.totalTokens)} tok.</span>
              </div>
            </div>
            <div className="model-usage-track">
              <div className="model-usage-fill" style={{ width: `${(model.requests / max) * 100}%` }} />
            </div>
          </div>
        ))}
        {!top.length && <div className="stats-empty">Les prochaines réponses alimenteront ce graphique.</div>}
      </div>
    </div>
  );
}

export function StatisticsModal({ conversations, onClose }: Props) {
  const [period, setPeriod] = useState<StatsPeriod>('today');
  const stats = useMemo(() => usageStatistics(conversations, period), [conversations, period]);

  const cards = [
    ['Requêtes', num(stats.requests)],
    ['Tokens total', num(stats.totalTokens)],
    ['Tokens entrée', num(stats.inputTokens)],
    ['Tokens sortie', num(stats.outputTokens)],
    ['Vitesse moyenne', stats.avgTokensPerSecond ? `${stats.avgTokensPerSecond.toFixed(1)} tok/s` : '—'],
    ['TTFT moyen', duration(stats.avgTtftMs)],
    ['Durée moyenne', duration(stats.avgDurationMs)],
    ['Temps IA total', duration(stats.totalDurationMs)],
    ['Erreurs', num(stats.errors)],
    ['Reconnexions', num(stats.reconnects)],
    ['Coût signalé', cost(stats.costUsd, stats.knownCostRequests)],
    ['Comptages estimés', num(stats.estimatedTokenRequests)],
  ];

  return (
    <div className="overlay stats-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="stats-modal" role="dialog" aria-modal="true" aria-label="Statistiques">
        <header className="stats-head">
          <div className="stats-title">
            <span className="stats-title-icon"><ChartIcon size={18} /></span>
            <div>
              <h2>Statistiques</h2>
              <p>Tokens, vitesse et usage des modèles. Aucun contenu de prompt n’est stocké ici.</p>
            </div>
          </div>
          <button className="settings-close icon-btn ghost" aria-label="Fermer" onClick={onClose}><XIcon /></button>
        </header>

        <div className="stats-body">
          <Segmented options={PERIODS} value={period} onChange={setPeriod} />

          <div className="stats-grid">
            {cards.map(([label, value]) => (
              <div className="stat-card" key={label}>
                <div className="stat-value">{value}</div>
                <div className="stat-label">{label}</div>
              </div>
            ))}
          </div>

          <div className="stats-note">
            Les compteurs marqués comme estimés sont utilisés uniquement quand le fournisseur ne renvoie pas son usage exact.
            Le local utilise les métriques llama.cpp lorsqu’elles sont disponibles. Les coûts cloud restent « — » si le fournisseur ne les renvoie pas.
          </div>

          <div className="stats-charts-grid">
            <ActivityChart points={stats.timeline} />
            <TokenChart points={stats.timeline} />
          </div>

          <ModelUsageChart models={stats.byModel} />

          <section className="stats-section">
            <div className="stats-section-head">
              <h3>Par fournisseur</h3>
              <span>{stats.byProvider.length} fournisseur{stats.byProvider.length > 1 ? 's' : ''}</span>
            </div>
            <div className="stats-table-wrap">
              <table className="stats-table">
                <thead>
                  <tr><th>Fournisseur</th><th>Req.</th><th>Tokens</th><th>tok/s</th><th>TTFT</th><th>Erreurs</th></tr>
                </thead>
                <tbody>
                  {stats.byProvider.map(row => (
                    <tr key={row.key}>
                      <td><strong>{row.label}</strong></td>
                      <td>{num(row.requests)}</td>
                      <td>{num(row.totalTokens)}</td>
                      <td>{row.avgTokensPerSecond ? row.avgTokensPerSecond.toFixed(1) : '—'}</td>
                      <td>{duration(row.avgTtftMs)}</td>
                      <td>{num(row.errors)}</td>
                    </tr>
                  ))}
                  {!stats.byProvider.length && <tr><td colSpan={6} className="stats-empty">Les prochaines réponses alimenteront les statistiques.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="stats-section">
            <div className="stats-section-head">
              <h3>Par modèle</h3>
              <span>{stats.byModel.length} modèle{stats.byModel.length > 1 ? 's' : ''}</span>
            </div>
            <div className="stats-model-list">
              {stats.byModel.map(row => (
                <div className="stats-model-row" key={row.key}>
                  <div className="stats-model-name">
                    <strong>{row.label}</strong>
                    <span>{row.providerLabel}</span>
                  </div>
                  <div className="stats-model-metrics">
                    <span><b>{num(row.requests)}</b> req.</span>
                    <span><b>{num(row.totalTokens)}</b> tokens</span>
                    <span><b>{row.avgTokensPerSecond ? row.avgTokensPerSecond.toFixed(1) : '—'}</b> tok/s</span>
                    <span><b>{duration(row.avgTtftMs)}</b> TTFT</span>
                  </div>
                </div>
              ))}
              {!stats.byModel.length && <div className="stats-empty">Aucune métrique pour cette période.</div>}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
