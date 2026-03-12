import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../context/DataContext'
import type { CptRange } from '../types'

type SortKey = 'lo' | 'label'

export default function CptRangesPage() {
  const navigate = useNavigate()
  const { cptRanges, saveCptRange, deleteCptRange, resetCptRanges } = useData()

  const [sortKey, setSortKey] = useState<SortKey>('lo')
  const [sortAsc, setSortAsc] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ lo: string; hi: string; label: string }>({ lo: '', hi: '', label: '' })
  const [newForm, setNewForm] = useState<{ lo: string; hi: string; label: string }>({ lo: '', hi: '', label: '' })
  const [confirmReset, setConfirmReset] = useState(false)
  const [saving, setSaving] = useState(false)

  const sorted = useMemo(() => {
    return [...cptRanges].sort((a, b) => {
      const av = sortKey === 'lo' ? a.lo : a.label.toLowerCase()
      const bv = sortKey === 'lo' ? b.lo : b.label.toLowerCase()
      return sortAsc ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0)
    })
  }, [cptRanges, sortKey, sortAsc])

  function startEdit(r: CptRange) {
    setEditingId(r.id)
    setEditForm({ lo: String(r.lo), hi: String(r.hi), label: r.label })
  }

  async function saveEdit(id: string) {
    const lo = parseInt(editForm.lo)
    const hi = parseInt(editForm.hi)
    if (isNaN(lo) || isNaN(hi) || !editForm.label.trim()) return
    setSaving(true)
    try {
      await saveCptRange({ id, lo, hi, label: editForm.label.trim() })
      setEditingId(null)
    } finally { setSaving(false) }
  }

  async function handleAdd() {
    const lo = parseInt(newForm.lo)
    const hi = parseInt(newForm.hi)
    if (isNaN(lo) || isNaN(hi) || !newForm.label.trim()) return
    setSaving(true)
    try {
      await saveCptRange({ id: crypto.randomUUID(), lo, hi: Math.max(lo, hi), label: newForm.label.trim() })
      setNewForm({ lo: '', hi: '', label: '' })
    } finally { setSaving(false) }
  }

  async function handleReset() {
    if (!confirmReset) { setConfirmReset(true); return }
    setSaving(true)
    try {
      await resetCptRanges()
      setConfirmReset(false)
      setEditingId(null)
    } finally { setSaving(false) }
  }

  const thCls = 'px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider'
  const inputCls = 'bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500'

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => navigate('/settings')} className="text-gray-600 hover:text-gray-300 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-2xl font-bold text-gray-100">CPT Code Ranges</h2>
      </div>
      <p className="text-xs text-gray-600 mb-6 ml-7">
        Maps CPT code ranges to procedure categories. Used throughout the app to resolve raw codes to readable labels.
      </p>

      {/* Actions bar */}
      <div className="flex items-center justify-between mb-4">
        {/* Sort controls */}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          Sort:
          {(['lo', 'label'] as SortKey[]).map(k => (
            <button key={k} onClick={() => { if (sortKey === k) setSortAsc(a => !a); else { setSortKey(k); setSortAsc(true) } }}
              className={`px-2 py-1 rounded border transition-colors ${sortKey === k ? 'border-indigo-600 text-indigo-400 bg-indigo-600/10' : 'border-gray-700 text-gray-500 hover:text-gray-300'}`}>
              {k === 'lo' ? 'Code' : 'Label'} {sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
            </button>
          ))}
        </div>

        {/* Reset button */}
        {confirmReset ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-amber-400">Reset all ranges to defaults?</span>
            <button onClick={handleReset} disabled={saving} className="px-2.5 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-500 disabled:opacity-50">Yes, Reset</button>
            <button onClick={() => setConfirmReset(false)} className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-300">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirmReset(true)} className="text-xs text-gray-600 hover:text-amber-400 transition-colors border border-gray-800 hover:border-amber-700 px-3 py-1.5 rounded-md">
            Reset to Defaults
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className={thCls + ' w-24'}>Lo</th>
                <th className={thCls + ' w-24'}>Hi</th>
                <th className={thCls}>Label</th>
                <th className={thCls + ' w-28'} />
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => {
                const isEditing = editingId === r.id
                return (
                  <tr key={r.id} className={`border-b border-gray-800 last:border-0 ${isEditing ? 'bg-indigo-950/20' : 'hover:bg-gray-800/40'}`}>
                    {isEditing ? (
                      <>
                        <td className="px-4 py-2">
                          <input type="number" value={editForm.lo} onChange={e => setEditForm(f => ({...f, lo: e.target.value}))}
                            onKeyDown={e => { if (e.key === 'Enter') saveEdit(r.id); if (e.key === 'Escape') setEditingId(null) }}
                            className={inputCls + ' w-20'} />
                        </td>
                        <td className="px-4 py-2">
                          <input type="number" value={editForm.hi} onChange={e => setEditForm(f => ({...f, hi: e.target.value}))}
                            onKeyDown={e => { if (e.key === 'Enter') saveEdit(r.id); if (e.key === 'Escape') setEditingId(null) }}
                            className={inputCls + ' w-20'} />
                        </td>
                        <td className="px-4 py-2">
                          <input type="text" value={editForm.label} onChange={e => setEditForm(f => ({...f, label: e.target.value}))}
                            onKeyDown={e => { if (e.key === 'Enter') saveEdit(r.id); if (e.key === 'Escape') setEditingId(null) }}
                            className={inputCls + ' w-full'} autoFocus />
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => saveEdit(r.id)} disabled={saving} className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-50">Save</button>
                            <button onClick={() => setEditingId(null)} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-300">Cancel</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2.5 text-gray-400 font-mono text-xs cursor-pointer hover:text-indigo-400" onClick={() => startEdit(r)}>{r.lo}</td>
                        <td className="px-4 py-2.5 text-gray-400 font-mono text-xs cursor-pointer hover:text-indigo-400" onClick={() => startEdit(r)}>{r.hi}</td>
                        <td className="px-4 py-2.5 text-gray-300 text-xs cursor-pointer hover:text-indigo-400" onClick={() => startEdit(r)}>{r.label}</td>
                        <td className="px-4 py-2.5">
                          <button onClick={() => deleteCptRange(r.id)} className="text-gray-700 hover:text-red-400 transition-colors" title="Delete">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add new range */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Add Range</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="number" placeholder="Lo" value={newForm.lo} onChange={e => setNewForm(f => ({...f, lo: e.target.value}))}
            className={inputCls + ' w-24'} />
          <input type="number" placeholder="Hi" value={newForm.hi} onChange={e => setNewForm(f => ({...f, hi: e.target.value}))}
            className={inputCls + ' w-24'} />
          <input type="text" placeholder="Label" value={newForm.label} onChange={e => setNewForm(f => ({...f, label: e.target.value}))}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            className={inputCls + ' flex-1 min-w-48'} />
          <button onClick={handleAdd} disabled={saving || !newForm.lo || !newForm.hi || !newForm.label.trim()}
            className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-md hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed font-medium">
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
