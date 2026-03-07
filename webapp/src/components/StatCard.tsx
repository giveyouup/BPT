import { useState } from 'react'

interface StatCardProps {
  label: string
  value: string
  sub?: string
  color?: 'default' | 'green' | 'indigo' | 'amber'
  private?: boolean
}

export default function StatCard({ label, value, sub, color = 'default', private: isPrivate = false }: StatCardProps) {
  const [hidden, setHidden] = useState(isPrivate)

  const valueColors = {
    default: 'text-gray-100',
    green: 'text-emerald-400',
    indigo: 'text-indigo-400',
    amber: 'text-amber-400',
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 px-5 py-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
        {isPrivate && (
          <button
            onClick={() => setHidden((h) => !h)}
            className="text-gray-600 hover:text-gray-400 transition-colors"
            aria-label={hidden ? 'Show value' : 'Hide value'}
          >
            {hidden ? (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        )}
      </div>
      <p className={`text-2xl font-bold mt-1 ${valueColors[color]}`}>
        {isPrivate && hidden ? '••••••' : value}
      </p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  )
}
