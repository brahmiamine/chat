import { useMemo, useState } from 'react';
import type { Conversation } from '../../types';
import { usageStatistics, type StatsPeriod } from '../../lib/statistics';
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
