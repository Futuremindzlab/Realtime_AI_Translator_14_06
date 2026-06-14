import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { BarChart2, ArrowRight, Globe, TrendingUp, RefreshCw } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { dynamoService } from '@/services/dynamoService';
import { SUPPORTED_LANGUAGES } from '@/lib/constants';

// ── helpers ──────────────────────────────────────────────────────────────────

function getLangName(code: string): string {
  const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
  return lang ? lang.name : code.toUpperCase();
}

interface PairStats {
  source: string;
  target: string;
  count: number;
}

interface LangCount {
  code: string;
  name: string;
  count: number;
}

function parsePairs(pairs: Record<string, number>): {
  pairList: PairStats[];
  bySource: LangCount[];
  byTarget: LangCount[];
} {
  const sourceMap: Record<string, number> = {};
  const targetMap: Record<string, number> = {};

  const pairList: PairStats[] = Object.entries(pairs).map(([key, count]) => {
    const [source, target] = key.split('→');
    sourceMap[source] = (sourceMap[source] || 0) + count;
    targetMap[target] = (targetMap[target] || 0) + count;
    return { source, target, count };
  });

  pairList.sort((a, b) => b.count - a.count);

  const bySource: LangCount[] = Object.entries(sourceMap)
    .map(([code, count]) => ({ code, name: getLangName(code), count }))
    .sort((a, b) => b.count - a.count);

  const byTarget: LangCount[] = Object.entries(targetMap)
    .map(([code, count]) => ({ code, name: getLangName(code), count }))
    .sort((a, b) => b.count - a.count);

  return { pairList, bySource, byTarget };
}

// ── sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function BarRow({
  label,
  count,
  max,
  color,
  badge,
}: {
  label: string;
  count: number;
  max: number;
  color: string;
  badge?: string;
}) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <View style={styles.barRow}>
      <View style={styles.barLabelRow}>
        <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
        {badge && <Text style={[styles.badge, { backgroundColor: color + '22', color }]}>{badge}</Text>}
        <Text style={styles.barCount}>{count}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function PairCard({ pair, rank, total }: { pair: PairStats; rank: number; total: number }) {
  const pct = total > 0 ? Math.round((pair.count / total) * 100) : 0;
  return (
    <View style={styles.pairCard}>
      <View style={styles.pairRank}>
        <Text style={styles.pairRankText}>#{rank}</Text>
      </View>
      <View style={styles.pairMiddle}>
        <View style={styles.pairLangs}>
          <Text style={styles.pairLang}>{getLangName(pair.source)}</Text>
          <ArrowRight size={14} color="#9ca3af" />
          <Text style={styles.pairLang}>{getLangName(pair.target)}</Text>
        </View>
        <View style={styles.pairBarTrack}>
          <View style={[styles.pairBarFill, { width: `${pct}%` as any }]} />
        </View>
      </View>
      <View style={styles.pairRight}>
        <Text style={styles.pairCount}>{pair.count}</Text>
        <Text style={styles.pairPct}>{pct}%</Text>
      </View>
    </View>
  );
}

// ── main screen ───────────────────────────────────────────────────────────────

export default function StatsScreen() {
  const { user } = useAuth();
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [total, setTotal]         = useState(0);
  const [pairList, setPairList]   = useState<PairStats[]>([]);
  const [bySource, setBySource]   = useState<LangCount[]>([]);
  const [byTarget, setByTarget]   = useState<LangCount[]>([]);

  const loadStats = useCallback(async () => {
    if (!user || !dynamoService.isInitialized()) {
      setLoading(false);
      return;
    }
    try {
      const data = await dynamoService.getStats();
      setTotal(data.total);
      const parsed = parsePairs(data.pairs || {});
      setPairList(parsed.pairList);
      setBySource(parsed.bySource);
      setByTarget(parsed.byTarget);
    } catch (err) {
      console.error('Stats load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { loadStats(); }, [loadStats]));

  const handleRefresh = () => { setRefreshing(true); loadStats(); };

  // ── not signed in ─────────────────────────────────────────────────────────
  if (!user) {
    return (
      <View style={styles.centerBox}>
        <Globe size={56} color="#d1d5db" />
        <Text style={styles.emptyTitle}>Sign In Required</Text>
        <Text style={styles.emptyText}>Please sign in from the Settings tab to view your dashboard.</Text>
      </View>
    );
  }

  // ── loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centerBox}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  // ── no data ───────────────────────────────────────────────────────────────
  if (total === 0) {
    return (
      <View style={styles.centerBox}>
        <BarChart2 size={56} color="#d1d5db" />
        <Text style={styles.emptyTitle}>No Data Yet</Text>
        <Text style={styles.emptyText}>Complete a translation to see your language stats.</Text>
      </View>
    );
  }

  const maxSource = bySource[0]?.count || 1;
  const maxTarget = byTarget[0]?.count || 1;

  // ── dashboard ─────────────────────────────────────────────────────────────
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}>

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Dashboard</Text>
          <Text style={styles.subtitle}>Your translation analytics</Text>
        </View>
        <TouchableOpacity onPress={handleRefresh} style={styles.refreshBtn}>
          <RefreshCw size={20} color="#2563eb" />
        </TouchableOpacity>
      </View>

      {/* Summary cards */}
      <View style={styles.cardRow}>
        <StatCard label="Total" value={total} color="#2563eb" />
        <StatCard label="Pairs" value={pairList.length} color="#7c3aed" />
        <StatCard label="Languages" value={bySource.length + byTarget.filter(t => !bySource.find(s => s.code === t.code)).length} color="#059669" />
      </View>

      {/* Top Language Pairs */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <TrendingUp size={18} color="#2563eb" />
          <Text style={styles.sectionTitle}>Top Language Pairs</Text>
        </View>
        {pairList.slice(0, 10).map((pair, i) => (
          <PairCard key={`${pair.source}-${pair.target}`} pair={pair} rank={i + 1} total={total} />
        ))}
      </View>

      {/* Source Languages */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Globe size={18} color="#7c3aed" />
          <Text style={styles.sectionTitle}>Most Used Source Languages</Text>
        </View>
        {bySource.map((lang, i) => (
          <BarRow
            key={lang.code}
            label={lang.name}
            count={lang.count}
            max={maxSource}
            color="#7c3aed"
            badge={i === 0 ? 'Top' : undefined}
          />
        ))}
      </View>

      {/* Target Languages */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Globe size={18} color="#059669" />
          <Text style={styles.sectionTitle}>Most Used Target Languages</Text>
        </View>
        {byTarget.map((lang, i) => (
          <BarRow
            key={lang.code}
            label={lang.name}
            count={lang.count}
            max={maxTarget}
            color="#059669"
            badge={i === 0 ? 'Top' : undefined}
          />
        ))}
      </View>

      {/* All Pairs Matrix */}
      {pairList.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <BarChart2 size={18} color="#d97706" />
            <Text style={styles.sectionTitle}>All Combinations</Text>
          </View>
          <View style={styles.matrixHeader}>
            <Text style={styles.matrixCol}>Source</Text>
            <Text style={styles.matrixArrow} />
            <Text style={styles.matrixCol}>Target</Text>
            <Text style={styles.matrixCount}>Count</Text>
          </View>
          {pairList.map((pair) => (
            <View key={`${pair.source}-${pair.target}`} style={styles.matrixRow}>
              <Text style={styles.matrixCell}>{getLangName(pair.source)}</Text>
              <ArrowRight size={12} color="#9ca3af" />
              <Text style={styles.matrixCell}>{getLangName(pair.target)}</Text>
              <View style={[styles.matrixBadge]}>
                <Text style={styles.matrixBadgeText}>{pair.count}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

    </ScrollView>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#f9fafb' },
  scrollContent: { paddingBottom: 40 },
  centerBox:     { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },

  emptyTitle: { fontSize: 22, fontWeight: '600', color: '#374151', marginTop: 16, marginBottom: 8 },
  emptyText:  { fontSize: 15, color: '#6b7280', textAlign: 'center', lineHeight: 22 },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, paddingTop: 56, backgroundColor: '#ffffff',
    borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  title:      { fontSize: 30, fontWeight: '700', color: '#111827', marginBottom: 2 },
  subtitle:   { fontSize: 14, color: '#6b7280' },
  refreshBtn: { padding: 8, borderRadius: 8, backgroundColor: '#eff6ff' },

  // summary cards
  cardRow: { flexDirection: 'row', gap: 12, padding: 16 },
  statCard: {
    flex: 1, backgroundColor: '#ffffff', borderRadius: 12, padding: 14,
    borderLeftWidth: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  statValue: { fontSize: 28, fontWeight: '700', marginBottom: 2 },
  statLabel: { fontSize: 12, color: '#6b7280', fontWeight: '500' },

  // sections
  section: {
    backgroundColor: '#ffffff', margin: 16, marginTop: 0, borderRadius: 16,
    padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  sectionTitle:  { fontSize: 16, fontWeight: '700', color: '#111827' },

  // bar rows
  barRow:      { marginBottom: 12 },
  barLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 6 },
  barLabel:    { flex: 1, fontSize: 14, color: '#374151', fontWeight: '500' },
  barCount:    { fontSize: 13, color: '#6b7280', fontWeight: '600', minWidth: 28, textAlign: 'right' },
  badge: { fontSize: 10, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  barTrack:    { height: 8, backgroundColor: '#f3f4f6', borderRadius: 4, overflow: 'hidden' },
  barFill:     { height: 8, borderRadius: 4 },

  // pair cards
  pairCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#f9fafb', borderRadius: 10, padding: 12, marginBottom: 8,
  },
  pairRank:     { width: 28, alignItems: 'center' },
  pairRankText: { fontSize: 12, fontWeight: '700', color: '#9ca3af' },
  pairMiddle:   { flex: 1 },
  pairLangs:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  pairLang:     { fontSize: 14, fontWeight: '600', color: '#1f2937' },
  pairBarTrack: { height: 6, backgroundColor: '#e5e7eb', borderRadius: 3, overflow: 'hidden' },
  pairBarFill:  { height: 6, borderRadius: 3, backgroundColor: '#2563eb' },
  pairRight:    { alignItems: 'flex-end', minWidth: 40 },
  pairCount:    { fontSize: 16, fontWeight: '700', color: '#2563eb' },
  pairPct:      { fontSize: 11, color: '#9ca3af' },

  // matrix
  matrixHeader: {
    flexDirection: 'row', alignItems: 'center', paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6', marginBottom: 4,
  },
  matrixCol:   { flex: 1, fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase' },
  matrixArrow: { width: 20 },
  matrixCount: { fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', width: 48, textAlign: 'right' },
  matrixRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#f9fafb',
  },
  matrixCell:      { flex: 1, fontSize: 14, color: '#374151' },
  matrixBadge:     { backgroundColor: '#eff6ff', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, minWidth: 36, alignItems: 'center' },
  matrixBadgeText: { fontSize: 13, fontWeight: '700', color: '#2563eb' },
});
