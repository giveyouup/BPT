/**
 * Anesthesia CPT code range → procedure category lookup.
 * Covers the standard anesthesia CPT range 00100–01999.
 * Codes are stored as strings like "00790"; leading zeros are stripped before comparison.
 */

const CPT_RANGES: Array<[number, number, string]> = [
  // Head
  [100, 126, 'Head — Integument'],
  [140, 148, 'Head — Salivary Glands'],
  [160, 196, 'Head — ENT'],
  [210, 222, 'Head — Dental/Oral'],

  // Neck
  [300, 322, 'Neck'],
  [350, 352, 'Neck — Larynx'],

  // Thorax (chest wall / breast)
  [400, 404, 'Thorax — Integument'],
  [406, 406, 'Thorax — Breast Biopsy'],
  [408, 474, 'Thorax — Breast/Chest Wall'],

  // Intrathoracic
  [500, 506, 'Intrathoracic — Lungs/Pleura'],
  [508, 508, 'Intrathoracic — Bronchoscopy'],
  [510, 514, 'Intrathoracic — Mediastinum'],
  [516, 522, 'Intrathoracic — Cardiac — Pacemaker/AICD'],
  [524, 530, 'Intrathoracic — Cardiac — Open Heart'],
  [532, 536, 'Intrathoracic — Cardiac — Pump Oxygenator'],
  [538, 542, 'Intrathoracic — Cardiac — EP Procedures'],
  [544, 546, 'Intrathoracic — Esophagus'],
  [548, 548, 'Intrathoracic — Diaphragm'],
  [550, 580, 'Intrathoracic — Lung/Pleura/Other'],

  // Spine & Spinal Cord
  [600, 620, 'Spine & Spinal Cord'],
  [622, 626, 'Spine — Cervical'],
  [630, 634, 'Spine — Thoracic/Lumbar'],
  [640, 670, 'Spine & Spinal Cord — Other'],

  // Upper Abdomen
  [700, 702, 'Upper Abdomen — Integument'],
  [730, 740, 'Upper Abdomen — Hernia'],
  [750, 756, 'Upper Abdomen — Upper GI / Stomach'],
  [760, 762, 'Upper Abdomen — Pancreas'],
  [770, 778, 'Upper Abdomen — Liver / Biliary'],
  [780, 782, 'Upper Abdomen — Spleen'],
  [790, 797, 'Upper Abdomen — Laparoscopy'],

  // Lower Abdomen
  [800, 802, 'Lower Abdomen — Integument'],
  [810, 816, 'Lower Abdomen — Hernia'],
  [820, 830, 'Lower Abdomen — Lower GI'],
  [840, 848, 'Lower Abdomen — Kidney/Ureter'],
  [850, 852, 'Lower Abdomen — Bladder/Urethra'],
  [860, 862, 'Lower Abdomen — Prostate'],
  [864, 882, 'Lower Abdomen — Other'],

  // Perineum
  [902, 904, 'Perineum'],
  [906, 908, 'Perineum — Anorectal'],
  [910, 920, 'Perineum — Genitalia'],
  [930, 952, 'Perineum — Other'],

  // Pelvis (except hip)
  [1000, 1004, 'Pelvis — Integument'],
  [1010, 1022, 'Pelvis — Gynecologic — Laparoscopy'],
  [1030, 1052, 'Pelvis — Gynecologic — Open'],
  [1060, 1070, 'Pelvis — Urologic'],
  [1080, 1090, 'Pelvis — Vascular'],
  [1100, 1190, 'Pelvis — Other'],

  // Upper Leg (except knee)
  [1200, 1210, 'Upper Leg — Integument'],
  [1220, 1230, 'Upper Leg — Muscle/Bone'],
  [1232, 1274, 'Upper Leg — Vascular/Other'],

  // Knee & Popliteal Area
  [1320, 1350, 'Knee — Arthroscopy'],
  [1360, 1382, 'Knee — Open'],
  [1392, 1444, 'Knee — Other'],

  // Lower Leg & Ankle
  [1462, 1470, 'Lower Leg & Ankle — Integument'],
  [1472, 1480, 'Lower Leg & Ankle — Muscle/Bone'],
  [1482, 1522, 'Lower Leg & Ankle — Other'],

  // Shoulder & Axilla
  [1600, 1610, 'Shoulder — Arthroscopy'],
  [1620, 1634, 'Shoulder — Open'],
  [1636, 1680, 'Shoulder — Other'],

  // Upper Arm & Elbow
  [1710, 1740, 'Upper Arm & Elbow'],
  [1750, 1782, 'Elbow — Other'],

  // Forearm, Wrist & Hand
  [1810, 1820, 'Forearm, Wrist & Hand'],
  [1830, 1860, 'Forearm, Wrist & Hand — Other'],

  // Radiological Procedures
  [1916, 1936, 'Radiology / Interventional'],

  // Burns
  [1951, 1953, 'Burns'],

  // Obstetric
  [1958, 1960, 'Obstetric — Labor / Delivery'],
  [1961, 1969, 'Obstetric — C-Section / Other'],

  // Special Circumstances
  [1990, 1991, 'Qualifying Circumstances'],
  [1992, 1999, 'Other Special Circumstances'],
]

export function getCptCategory(cptAsa: string): string | null {
  const digits = cptAsa.replace(/\D/g, '')
  if (!digits) return null
  const code = parseInt(digits, 10)
  if (isNaN(code)) return null

  for (const [lo, hi, label] of CPT_RANGES) {
    if (code >= lo && code <= hi) return label
  }
  return null
}
