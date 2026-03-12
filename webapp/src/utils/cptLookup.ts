/**
 * CPT code → procedure category lookup.
 *
 * Anesthesia section (00100–01999) follows AMA CPT codebook structure.
 * Also covers:
 *  • Spinal canal injections (62xxx)
 *  • Peripheral nerve blocks (64xxx)
 *  • Imaging guidance (76xxx)
 *  • Anesthesia qualifying circumstances (99100–99140)
 *  • Hospital & office E&M (99201–99239)
 *  • Selected vascular/line placement codes
 *
 * Codes may arrive as "00790/00790" (slash-duplicated). Only the first
 * segment before the slash is used.
 */

import type { CptRange } from '../types'

export const DEFAULT_CPT_RANGES: Array<{ lo: number; hi: number; label: string }> = [

  // ── Head (00100–00222) ────────────────────────────────────────────────────
  { lo: 100, hi: 104, label: 'Head — Integument / Scalp / Cleft Lip / ECT' },
  { lo: 120, hi: 126, label: 'Head — Ear' },
  { lo: 140, hi: 148, label: 'Head — Eye' },
  { lo: 160, hi: 164, label: 'Head — Nose & Sinuses' },
  { lo: 170, hi: 176, label: 'Head — Intraoral / Oropharynx' },
  { lo: 190, hi: 196, label: 'Head — Facial Bones & Skull' },
  { lo: 210, hi: 222, label: 'Head — Intracranial' },

  // ── Neck (00300–00352) ────────────────────────────────────────────────────
  { lo: 300, hi: 300, label: 'Neck — Integument' },
  { lo: 320, hi: 322, label: 'Neck — Larynx & Trachea' },
  { lo: 350, hi: 352, label: 'Neck — Major Vessels' },

  // ── Thorax / Chest Wall (00400–00474) ────────────────────────────────────
  { lo: 400, hi: 408, label: 'Thorax — Breast & Chest Wall' },
  { lo: 410, hi: 410, label: 'Thorax — Electrical Cardioversion' },
  { lo: 450, hi: 454, label: 'Thorax — Clavicle & Scapula' },
  { lo: 470, hi: 474, label: 'Thorax — Ribs' },

  // ── Intrathoracic (00500–00580) ───────────────────────────────────────────
  { lo: 500, hi: 500, label: 'Intrathoracic — Esophagus' },
  { lo: 502, hi: 502, label: 'Intrathoracic — Intercostal Catheters' },
  { lo: 520, hi: 529, label: 'Intrathoracic — Mediastinum / Thoracoscopy / Pleura' },
  { lo: 530, hi: 530, label: 'Intrathoracic — Pacemaker / ICD Insertion' },
  { lo: 532, hi: 532, label: 'Intrathoracic — Central Venous Access' },
  { lo: 534, hi: 534, label: 'Intrathoracic — Transesophageal Echocardiography (TEE)' },
  { lo: 537, hi: 539, label: 'Intrathoracic — Cardiac EP / Tracheobronchial' },
  { lo: 540, hi: 548, label: 'Intrathoracic — Thoracotomy / Pulmonary / Trachea' },
  { lo: 550, hi: 550, label: 'Intrathoracic — Sternum' },
  { lo: 560, hi: 580, label: 'Intrathoracic — Heart & Great Vessels / Cardiac Surgery' },

  // ── Spine & Spinal Cord (00600–00670) ────────────────────────────────────
  { lo: 600, hi: 604, label: 'Spine — Cervical' },
  { lo: 620, hi: 626, label: 'Spine — Thoracic' },
  { lo: 630, hi: 640, label: 'Spine — Lumbar' },
  { lo: 670, hi: 670, label: 'Spine — Extensive / Complex Procedures' },

  // ── Upper Abdomen (00700–00797) ───────────────────────────────────────────
  { lo: 700, hi: 702, label: 'Upper Abdomen — Anterior Wall / Liver' },
  { lo: 730, hi: 740, label: 'Upper Abdomen — Upper GI / Endoscopy' },
  { lo: 750, hi: 756, label: 'Upper Abdomen — Hernia' },
  { lo: 770, hi: 770, label: 'Upper Abdomen — Major Abdominal Vessels' },
  { lo: 790, hi: 797, label: 'Upper Abdomen — Intraabdominal / GI / Bariatric / Transplant' },

  // ── Lower Abdomen (00800–00882) ───────────────────────────────────────────
  { lo: 800, hi: 802, label: 'Lower Abdomen — Anterior Wall / Panniculectomy' },
  { lo: 810, hi: 813, label: 'Lower Abdomen — Lower GI Endoscopy' },
  { lo: 820, hi: 836, label: 'Lower Abdomen — Hernia / Intestine' },
  { lo: 840, hi: 852, label: 'Lower Abdomen — Intraabdominal / Pelvic / Gynecologic' },
  { lo: 860, hi: 873, label: 'Lower Abdomen — Kidney / Ureter / Bladder / Urology' },
  { lo: 880, hi: 882, label: 'Lower Abdomen — Major Vessels' },

  // ── Perineum (00902–00952) ────────────────────────────────────────────────
  { lo: 902, hi: 908, label: 'Perineum — Anorectal / Perineal Prostatectomy' },
  { lo: 910, hi: 918, label: 'Perineum — Transurethral (TURP / TURBT)' },
  { lo: 920, hi: 938, label: 'Perineum — Male Genitalia' },
  { lo: 940, hi: 952, label: 'Perineum — Vaginal / Uterine / Hysteroscopy' },

  // ── Pelvis (01000–01190) ──────────────────────────────────────────────────
  { lo: 1000, hi: 1005, label: 'Pelvis — Integument' },
  { lo: 1010, hi: 1022, label: 'Pelvis — Gynecologic — Laparoscopy' },
  { lo: 1030, hi: 1052, label: 'Pelvis — Gynecologic — Open' },
  { lo: 1060, hi: 1070, label: 'Pelvis — Urologic' },
  { lo: 1080, hi: 1090, label: 'Pelvis — Vascular' },
  { lo: 1100, hi: 1190, label: 'Pelvis — Bony Pelvis / Hip Joint / Other' },

  // ── Upper Leg (01200–01274) ───────────────────────────────────────────────
  { lo: 1200, hi: 1215, label: 'Upper Leg / Hip — Arthroplasty & Open Procedures' },
  { lo: 1220, hi: 1230, label: 'Upper Leg — Muscle & Bone' },
  { lo: 1232, hi: 1274, label: 'Upper Leg — Vascular / Other' },

  // ── Knee & Popliteal Area (01320–01444) ───────────────────────────────────
  { lo: 1320, hi: 1350, label: 'Knee — Arthroscopy' },
  { lo: 1360, hi: 1382, label: 'Knee — Open' },
  { lo: 1392, hi: 1444, label: 'Knee — Other' },

  // ── Lower Leg & Ankle (01462–01522) ──────────────────────────────────────
  { lo: 1462, hi: 1470, label: 'Lower Leg & Ankle — Integument' },
  { lo: 1472, hi: 1480, label: 'Lower Leg & Ankle — Muscle & Bone' },
  { lo: 1482, hi: 1522, label: 'Lower Leg & Ankle — Other' },

  // ── Shoulder & Axilla (01600–01680) ──────────────────────────────────────
  { lo: 1600, hi: 1610, label: 'Shoulder — Arthroscopy' },
  { lo: 1620, hi: 1634, label: 'Shoulder — Open' },
  { lo: 1636, hi: 1680, label: 'Shoulder — Other' },

  // ── Upper Arm & Elbow (01710–01782) ──────────────────────────────────────
  { lo: 1710, hi: 1740, label: 'Upper Arm & Elbow' },
  { lo: 1750, hi: 1782, label: 'Elbow — Other' },

  // ── Forearm, Wrist & Hand (01810–01860) ──────────────────────────────────
  { lo: 1810, hi: 1820, label: 'Forearm, Wrist & Hand' },
  { lo: 1830, hi: 1860, label: 'Forearm, Wrist & Hand — Other' },

  // ── Radiological / Interventional (01916–01936) ───────────────────────────
  { lo: 1916, hi: 1942, label: 'Radiology / Interventional / Cath Lab' },

  // ── Burns (01951–01953) ───────────────────────────────────────────────────
  { lo: 1951, hi: 1953, label: 'Burns — Excision / Debridement' },

  // ── Obstetric (01958–01969) ───────────────────────────────────────────────
  { lo: 1958, hi: 1960, label: 'Obstetric — Labor / Vaginal Delivery' },
  { lo: 1961, hi: 1969, label: 'Obstetric — C-Section / Other' },

  // ── Other Anesthesia Procedures (01990–01999) ─────────────────────────────
  { lo: 1990, hi: 1991, label: 'Anesthesia — Physiological Support / Brain Dead Patient' },
  { lo: 1992, hi: 1996, label: 'Anesthesia — Epidural/Subarachnoid Daily Management' },
  { lo: 1997, hi: 1999, label: 'Anesthesia — Other' },

  // ── Spinal Canal Injections (62xxx) ──────────────────────────────────────
  { lo: 62310, hi: 62350, label: 'Spinal Canal — Epidural / Intrathecal Injection' },

  // ── Peripheral Nerve Blocks (64xxx) ──────────────────────────────────────
  { lo: 64400, hi: 64408, label: 'Regional — Head & Neck Nerve Blocks' },
  { lo: 64410, hi: 64419, label: 'Regional — Brachial Plexus & Shoulder Blocks' },
  { lo: 64420, hi: 64435, label: 'Regional — Trunk Nerve Blocks' },
  { lo: 64436, hi: 64489, label: 'Regional — Extremity & Fascial Plane Blocks' },
  { lo: 64490, hi: 64530, label: 'Regional — Facet Joint & Sympathetic Blocks' },
  { lo: 64600, hi: 64681, label: 'Regional — Neurolytic Procedures' },
  { lo: 64700, hi: 64999, label: 'Regional — Other Nerve Procedures' },

  // ── Vascular / Line Placement ────────────────────────────────────────────
  { lo: 36555, hi: 36590, label: 'Vascular — Central Venous / PICC Catheter' },
  { lo: 36620, hi: 36620, label: 'Vascular — Arterial Catheter' },
  { lo: 36625, hi: 36660, label: 'Vascular — Central / Arterial Line' },

  // ── Imaging / Guidance ────────────────────────────────────────────────────
  { lo: 76000, hi: 76001, label: 'Imaging — Fluoroscopy' },
  { lo: 76930, hi: 76942, label: 'Imaging — Ultrasound Guidance' },
  { lo: 76945, hi: 76965, label: 'Imaging — Other Guidance' },
  { lo: 77002, hi: 77003, label: 'Imaging — Fluoroscopic Guidance (Needle Placement)' },

  // ── Anesthesia Qualifying Circumstances ──────────────────────────────────
  { lo: 99100, hi: 99100, label: 'Qualifying Circumstance — Extreme Age' },
  { lo: 99116, hi: 99116, label: 'Qualifying Circumstance — Hypothermia' },
  { lo: 99135, hi: 99135, label: 'Qualifying Circumstance — Controlled Hypotension' },
  { lo: 99140, hi: 99140, label: 'Qualifying Circumstance — Emergency' },

  // ── Evaluation & Management ───────────────────────────────────────────────
  { lo: 99201, hi: 99215, label: 'E&M — Office / Outpatient Visit' },
  { lo: 99221, hi: 99223, label: 'E&M — Initial Hospital Care' },
  { lo: 99231, hi: 99233, label: 'E&M — Subsequent Hospital Care' },
  { lo: 99234, hi: 99236, label: 'E&M — Observation / Same-Day Admission' },
  { lo: 99238, hi: 99239, label: 'E&M — Hospital Discharge' },
]

export function getCptCategory(cptAsa: string, ranges: CptRange[]): string | null {
  const primary = cptAsa.split('/')[0].trim()
  const digits = primary.replace(/\D/g, '')
  if (!digits) return null
  const code = parseInt(digits, 10)
  if (isNaN(code)) return null
  for (const { lo, hi, label } of ranges) {
    if (code >= lo && code <= hi) return label
  }
  return null
}
