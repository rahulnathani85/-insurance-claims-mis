-- Migration V6: Sample Data for Development Mode
-- SAFE: Only inserts data with company='Development'. No production data touched.
-- Run this in Supabase SQL Editor AFTER migration_v5.
--
-- This creates realistic test data to test all features:
-- - 20 Claims across all LOBs
-- - 10 Policies
-- - 8 Survey Fee Bills
-- - 3 Users (Admin, Surveyor, Staff)
-- - 4 LOR/ILA Templates (Fire, Marine, Engineering, General)
-- - Sample claim stages and document tracking entries

-- ============================================
-- 1. SAMPLE USERS (for Login System)
-- ============================================
INSERT INTO app_users (email, password_hash, name, role, company) VALUES
  ('admin@nisla.in', 'admin123', 'Rahul Nathani', 'Admin', 'NISLA'),
  ('surveyor@nisla.in', 'surveyor123', 'Amit Sharma', 'Surveyor', 'NISLA'),
  ('staff@nisla.in', 'staff123', 'Priya Patel', 'Staff', 'NISLA'),
  ('dev@nisla.in', 'dev123', 'Dev Tester', 'Admin', 'Development')
ON CONFLICT (email) DO NOTHING;

-- ============================================
-- 2. SAMPLE CLAIMS (20 claims across all LOBs)
-- ============================================
INSERT INTO claims (ref_number, lob, policy_number, insurer_name, claim_number, appointing_insurer, policy_type, date_intimation, date_loss, date_survey, date_lor, insured_name, loss_location, place_survey, gross_loss, assessed_loss, status, remark, company, folder_path) VALUES

-- Fire Claims (4)
('DEV-001/26-27/Fire', 'Fire', 'FP-2026-1001', 'New India Assurance', 'FI-CLM-2026-001', 'New India Assurance - Mumbai RO', 'Standard Fire & Special Perils', '2026-03-15', '2026-03-12', '2026-03-18', NULL, 'Mehta Textiles Pvt Ltd', 'Plot 45, MIDC Andheri East, Mumbai', 'Mumbai', 850000, 720000, 'In Process', 'Fire broke out in godown section. Electrical short circuit suspected.', 'Development', 'D:\2026-27\Development\Fire\DEV-001 - Mehta Textiles'),
('DEV-002/26-27/Fire', 'Fire', 'FP-2026-1002', 'United India Insurance', 'FI-CLM-2026-002', 'United India Insurance - Pune RO', 'Industrial All Risks', '2026-03-20', '2026-03-18', '2026-03-22', '2026-03-25', 'Sharma Industries', 'Survey No. 112, Hadapsar Industrial Area, Pune', 'Pune', 2500000, 2100000, 'Submitted', 'Machine room fire. Report submitted with full assessment.', 'Development', 'D:\2026-27\Development\Fire\DEV-002 - Sharma Industries'),
('DEV-003/26-27/Fire', 'Fire', 'FP-2026-1003', 'ICICI Lombard', 'FI-CLM-2026-003', 'ICICI Lombard - Ahmedabad', 'Standard Fire & Special Perils', '2026-04-01', '2026-03-30', NULL, NULL, 'Gujarat Cotton Mills', 'GIDC Phase 2, Vatva, Ahmedabad', 'Ahmedabad', 5000000, NULL, 'Open', 'Major fire in cotton storage. Survey pending.', 'Development', 'D:\2026-27\Development\Fire\DEV-003 - Gujarat Cotton Mills'),
('DEV-004/26-27/Fire', 'Fire', 'FP-2026-1004', 'Bajaj Allianz', 'FI-CLM-2026-004', 'Bajaj Allianz - Nagpur Branch', 'Consequential Loss', '2026-04-05', '2026-04-03', '2026-04-06', NULL, 'Vidarbha Steel Works', 'Butibori Industrial Area, Nagpur', 'Nagpur', 1200000, 950000, 'In Process', 'Fire damage to electrical panels. BI claim also filed.', 'Development', 'D:\2026-27\Development\Fire\DEV-004 - Vidarbha Steel'),

-- Engineering Claims (3)
('DEV-005/26-27/Engg', 'Engineering', 'EP-2026-2001', 'Oriental Insurance', 'EN-CLM-2026-001', 'Oriental Insurance - Mumbai DO', 'Contractors All Risk', '2026-03-10', '2026-03-08', '2026-03-14', '2026-03-20', 'Larsen Constructions', 'Highway NH-48, Km 125, Near Karjat', 'Karjat', 3200000, 2800000, 'Submitted', 'Crane collapse during highway construction. Equipment damage.', 'Development', 'D:\2026-27\Development\Engineering\DEV-005 - Larsen Constructions'),
('DEV-006/26-27/Engg', 'Engineering', 'EP-2026-2002', 'HDFC ERGO', 'EN-CLM-2026-002', 'HDFC ERGO - Pune', 'Erection All Risk', '2026-03-25', '2026-03-22', '2026-03-28', NULL, 'Thermax Ltd', 'MIDC Chakan, Pune', 'Pune', 1800000, 1500000, 'In Process', 'Boiler erection damage during testing phase.', 'Development', 'D:\2026-27\Development\Engineering\DEV-006 - Thermax Ltd'),
('DEV-007/26-27/Engg', 'Engineering', 'EP-2026-2003', 'Tata AIG', 'EN-CLM-2026-003', 'Tata AIG - Mumbai', 'Machinery Breakdown', '2026-04-02', '2026-04-01', NULL, NULL, 'Bharat Forge Ltd', 'Mundhwa Industrial Estate, Pune', 'Pune', 750000, NULL, 'Open', 'CNC machine breakdown. Awaiting survey schedule.', 'Development', 'D:\2026-27\Development\Engineering\DEV-007 - Bharat Forge'),

-- Marine Cargo Claims (3)
('DEV-TMT-001/26-27', 'Marine Cargo', 'MC-2026-3001', 'New India Assurance', 'MC-CLM-2026-001', 'New India Assurance - Marine Dept', 'Marine Cargo (Inland)', '2026-03-05', '2026-03-03', '2026-03-08', '2026-03-12', 'Tata Motors Ltd', 'Ranjangaon Plant, Pune to Dharwad Depot', 'Pune', 450000, 380000, 'Submitted', 'Transit damage to auto parts. 12 cartons damaged.', 'Development', 'D:\2026-27\Development\Marine Cargo\DEV-TMT-001 - Tata Motors'),
('DEV-GRASIM-001/26-27', 'Marine Cargo', 'MC-2026-3002', 'United India Insurance', 'MC-CLM-2026-002', 'United India Insurance - Marine', 'Marine Cargo (Import)', '2026-03-18', '2026-03-15', '2026-03-20', NULL, 'Grasim Industries Ltd', 'Nhava Sheva Port to Nagda Plant', 'Mumbai', 1200000, 980000, 'In Process', 'Container damage during port handling. Chemical spill.', 'Development', 'D:\2026-27\Development\Marine Cargo\DEV-GRASIM-001 - Grasim'),
('DEV-4001/26-27/Marine', 'Marine Cargo', 'MC-2026-3003', 'ICICI Lombard', 'MC-CLM-2026-003', 'ICICI Lombard - Marine', 'Marine Cargo (Inland)', '2026-04-01', '2026-03-29', NULL, NULL, 'Reliance Retail Ltd', 'Mumbai Warehouse to Hyderabad DC', 'Mumbai', 320000, NULL, 'Open', 'Water damage to FMCG goods during transit. Survey pending.', 'Development', 'D:\2026-27\Development\Marine Cargo\DEV-4001 - Reliance Retail'),

-- Extended Warranty Claims (2)
('DEV-EW-0001/26-27', 'Extended Warranty', 'EW-2026-4001', 'Bajaj Allianz', 'EW-CLM-2026-001', 'Bajaj Allianz - EW Division', 'Extended Warranty', '2026-03-12', '2026-03-10', '2026-03-15', '2026-03-18', 'Godrej Appliances Ltd', 'Godrej One, Vikhroli, Mumbai', 'Mumbai', 85000, 72000, 'Submitted', 'Washing machine motor failure. Under extended warranty.', 'Development', 'D:\2026-27\Development\Extended Warranty\DEV-EW-0001 - Godrej'),
('DEV-EW-0002/26-27', 'Extended Warranty', 'EW-2026-4002', 'HDFC ERGO', 'EW-CLM-2026-002', 'HDFC ERGO - Consumer', 'Extended Warranty', '2026-04-03', '2026-04-01', NULL, NULL, 'Samsung India Electronics', 'Noida Service Center', 'Noida', 120000, NULL, 'Open', 'LED TV panel defect. Warranty claim assessment needed.', 'Development', 'D:\2026-27\Development\Extended Warranty\DEV-EW-0002 - Samsung'),

-- Business Interruption Claims (2)
('DEV-008/26-27/BI', 'Business Interruption', 'BI-2026-5001', 'New India Assurance', 'BI-CLM-2026-001', 'New India Assurance - Mumbai', 'Business Interruption', '2026-03-20', '2026-03-12', '2026-03-22', NULL, 'Mehta Textiles Pvt Ltd', 'Plot 45, MIDC Andheri East, Mumbai', 'Mumbai', 3500000, 2800000, 'In Process', 'BI claim linked to fire claim DEV-001. Revenue loss during shutdown.', 'Development', 'D:\2026-27\Development\Business Interruption\DEV-008 - Mehta Textiles'),
('DEV-009/26-27/BI', 'Business Interruption', 'BI-2026-5002', 'Oriental Insurance', 'BI-CLM-2026-002', 'Oriental Insurance - Pune', 'Loss of Profit', '2026-04-05', '2026-04-03', NULL, NULL, 'Pune Auto Components Ltd', 'Ranjangaon MIDC, Pune', 'Pune', 1800000, NULL, 'Open', 'Production loss due to machinery breakdown.', 'Development', 'D:\2026-27\Development\Business Interruption\DEV-009 - Pune Auto'),

-- Miscellaneous Claims (2)
('DEV-010/26-27/Misc.', 'Miscellaneous', 'MS-2026-6001', 'Tata AIG', 'MS-CLM-2026-001', 'Tata AIG - Mumbai', 'Burglary & Housebreaking', '2026-03-08', '2026-03-06', '2026-03-10', '2026-03-14', 'Jewels Paradise', 'Zaveri Bazaar, Mumbai', 'Mumbai', 1500000, 1200000, 'Submitted', 'Burglary at jewelry shop. Stock and cash stolen.', 'Development', 'D:\2026-27\Development\Miscellaneous\DEV-010 - Jewels Paradise'),
('DEV-011/26-27/Misc.', 'Miscellaneous', 'MS-2026-6002', 'ICICI Lombard', 'MS-CLM-2026-002', 'ICICI Lombard - Mumbai', 'Electronic Equipment', '2026-04-02', '2026-03-30', '2026-04-04', NULL, 'TechServe Solutions', 'BKC, Mumbai', 'Mumbai', 650000, 520000, 'In Process', 'Server room damage due to power surge.', 'Development', 'D:\2026-27\Development\Miscellaneous\DEV-011 - TechServe'),

-- Liability Claim (1)
('DEV-012/26-27/LIABILITY', 'Liability', 'LB-2026-7001', 'HDFC ERGO', 'LB-CLM-2026-001', 'HDFC ERGO - Liability Div', 'Public Liability', '2026-03-25', '2026-03-22', '2026-03-28', NULL, 'Metro Mall Pvt Ltd', 'Andheri West, Mumbai', 'Mumbai', 800000, 650000, 'In Process', 'Visitor slip and fall injury at mall premises.', 'Development', 'D:\2026-27\Development\Liability\DEV-012 - Metro Mall'),

-- Banking Claim (1)
('DEV-INS-0001/26-27', 'Banking', 'BK-2026-8001', 'New India Assurance', 'BK-CLM-2026-001', 'New India Assurance - Banking', 'Bankers Indemnity', '2026-03-15', '2026-03-12', '2026-03-18', '2026-03-22', 'State Bank of India - Nariman Point', 'SBI Main Branch, Nariman Point, Mumbai', 'Mumbai', 2200000, 1900000, 'Submitted', 'Cash in transit robbery. Insurance claim filed.', 'Development', 'D:\2026-27\Development\Banking\DEV-INS-0001 - SBI');

-- ============================================
-- 3. SAMPLE POLICIES (10 policies)
-- ============================================
INSERT INTO policies (policy_number, insurer, insured_name, city, lob, policy_type, sum_insured, premium, start_date, end_date, company, folder_path) VALUES
('FP-2026-1001', 'New India Assurance', 'Mehta Textiles Pvt Ltd', 'Mumbai', 'Fire', 'Standard Fire & Special Perils', '50000000', '125000', '2026-01-01', '2027-01-01', 'Development', 'D:\2026-27\Development\Policies\FP-2026-1001 - Mehta Textiles'),
('FP-2026-1002', 'United India Insurance', 'Sharma Industries', 'Pune', 'Fire', 'Industrial All Risks', '100000000', '250000', '2026-01-15', '2027-01-15', 'Development', 'D:\2026-27\Development\Policies\FP-2026-1002 - Sharma Industries'),
('FP-2026-1003', 'ICICI Lombard', 'Gujarat Cotton Mills', 'Ahmedabad', 'Fire', 'Standard Fire & Special Perils', '200000000', '450000', '2025-12-01', '2026-12-01', 'Development', 'D:\2026-27\Development\Policies\FP-2026-1003 - Gujarat Cotton'),
('EP-2026-2001', 'Oriental Insurance', 'Larsen Constructions', 'Mumbai', 'Engineering', 'Contractors All Risk', '500000000', '600000', '2025-06-01', '2027-06-01', 'Development', 'D:\2026-27\Development\Policies\EP-2026-2001 - Larsen'),
('EP-2026-2002', 'HDFC ERGO', 'Thermax Ltd', 'Pune', 'Engineering', 'Erection All Risk', '80000000', '180000', '2026-01-01', '2027-01-01', 'Development', 'D:\2026-27\Development\Policies\EP-2026-2002 - Thermax'),
('MC-2026-3001', 'New India Assurance', 'Tata Motors Ltd', 'Pune', 'Marine Cargo', 'Marine Cargo (Inland)', '10000000', '35000', '2026-01-01', '2027-01-01', 'Development', 'D:\2026-27\Development\Policies\MC-2026-3001 - Tata Motors'),
('MC-2026-3002', 'United India Insurance', 'Grasim Industries Ltd', 'Mumbai', 'Marine Cargo', 'Marine Cargo (Import)', '25000000', '75000', '2025-10-01', '2026-10-01', 'Development', 'D:\2026-27\Development\Policies\MC-2026-3002 - Grasim'),
('EW-2026-4001', 'Bajaj Allianz', 'Godrej Appliances Ltd', 'Mumbai', 'Extended Warranty', 'Extended Warranty', '500000', '12000', '2025-06-01', '2028-06-01', 'Development', 'D:\2026-27\Development\Policies\EW-2026-4001 - Godrej'),
('BI-2026-5001', 'New India Assurance', 'Mehta Textiles Pvt Ltd', 'Mumbai', 'Business Interruption', 'Business Interruption', '20000000', '95000', '2026-01-01', '2027-01-01', 'Development', 'D:\2026-27\Development\Policies\BI-2026-5001 - Mehta Textiles'),
('LB-2026-7001', 'HDFC ERGO', 'Metro Mall Pvt Ltd', 'Mumbai', 'Liability', 'Public Liability', '5000000', '45000', '2025-09-01', '2026-09-01', 'Development', 'D:\2026-27\Development\Policies\LB-2026-7001 - Metro Mall');

-- ============================================
-- 4. SAMPLE SURVEY FEE BILLS (8 bills)
-- ============================================
INSERT INTO survey_fee_bills (bill_number, bill_date, ref_number, lob, insured_name, insurer_name, company, loss_amount, fee_type, calculated_fee, gst_rate, gst_amount, total_amount, payment_status, remarks) VALUES
('DEV/SF/0001/26-27', '2026-03-25', 'DEV-001/26-27/Fire', 'Fire', 'Mehta Textiles Pvt Ltd', 'New India Assurance', 'Development', 850000, 'GIPSA', 25000, 18, 4500, 29500, 'Pending', 'Fire claim survey fee'),
('DEV/SF/0002/26-27', '2026-03-22', 'DEV-002/26-27/Fire', 'Fire', 'Sharma Industries', 'United India Insurance', 'Development', 2500000, 'GIPSA', 70000, 18, 12600, 82600, 'Paid', 'IAR claim - full assessment done'),
('DEV/SF/0003/26-27', '2026-03-20', 'DEV-005/26-27/Engg', 'Engineering', 'Larsen Constructions', 'Oriental Insurance', 'Development', 3200000, 'GIPSA', 84000, 18, 15120, 99120, 'Paid', 'CAR claim survey completed'),
('DEV/SF/0004/26-27', '2026-03-12', 'DEV-TMT-001/26-27', 'Marine Cargo', 'Tata Motors Ltd', 'New India Assurance', 'Development', 450000, 'GIPSA', 18000, 18, 3240, 21240, 'Paid', 'Marine cargo transit damage'),
('DEV/SF/0005/26-27', '2026-03-18', 'DEV-EW-0001/26-27', 'Extended Warranty', 'Godrej Appliances Ltd', 'Bajaj Allianz', 'Development', 85000, 'GIPSA', 3400, 18, 612, 4012, 'Pending', 'EW claim - appliance failure'),
('DEV/SF/0006/26-27', '2026-03-14', 'DEV-010/26-27/Misc.', 'Miscellaneous', 'Jewels Paradise', 'Tata AIG', 'Development', 1500000, 'GIPSA', 50000, 18, 9000, 59000, 'Paid', 'Burglary claim assessment'),
('DEV/SF/0007/26-27', '2026-03-28', 'DEV-012/26-27/LIABILITY', 'Liability', 'Metro Mall Pvt Ltd', 'HDFC ERGO', 'Development', 800000, 'GIPSA', 34000, 18, 6120, 40120, 'Pending', 'Public liability claim'),
('DEV/SF/0008/26-27', '2026-03-22', 'DEV-INS-0001/26-27', 'Banking', 'State Bank of India - Nariman Point', 'New India Assurance', 'Development', 2200000, 'GIPSA', 54000, 18, 9720, 63720, 'Paid', 'Bankers indemnity claim');

-- Update Development bill counter
UPDATE bill_counters SET counter_value = 8 WHERE company = 'Development';

-- ============================================
-- 5. SAMPLE DOCUMENT TEMPLATES (LOR & ILA)
-- ============================================
INSERT INTO document_templates (name, type, lob, company, content, is_default, created_by) VALUES

-- Fire LOR Template
('Fire LOR - Standard', 'LOR', 'Fire', 'Development',
'<h2 style="text-align:center;">LETTER OF RECOMMENDATION</h2>
<p style="text-align:center;"><strong>{{company}}</strong></p>
<p style="text-align:right;">Date: {{date_today}}</p>
<hr/>
<p><strong>To,</strong><br/>{{appointing_insurer}}</p>
<p><strong>Subject:</strong> Letter of Recommendation - {{lob}} Claim<br/>
<strong>Ref No:</strong> {{ref_number}}<br/>
<strong>Claim No:</strong> {{claim_number}}<br/>
<strong>Policy No:</strong> {{policy_number}}<br/>
<strong>Insured:</strong> {{insured_name}}</p>
<hr/>
<p>Dear Sir/Madam,</p>
<p>With reference to the above-mentioned claim, we have completed our preliminary survey and assessment. Following are the details and our recommendation:</p>
<h3>1. BACKGROUND</h3>
<p>We were appointed to investigate and assess the loss arising out of <strong>{{policy_type}}</strong> policy. The incident occurred on <strong>{{date_loss}}</strong> at <strong>{{loss_location}}</strong>.</p>
<h3>2. NATURE OF LOSS</h3>
<p>[Describe the nature and cause of loss here]</p>
<h3>3. SURVEY DETAILS</h3>
<table style="border-collapse:collapse;width:100%;">
<tr><td style="border:1px solid #333;padding:8px;width:40%;"><strong>Date of Survey</strong></td><td style="border:1px solid #333;padding:8px;">{{date_survey}}</td></tr>
<tr><td style="border:1px solid #333;padding:8px;"><strong>Place of Survey</strong></td><td style="border:1px solid #333;padding:8px;">{{place_survey}}</td></tr>
<tr><td style="border:1px solid #333;padding:8px;"><strong>Date of Loss</strong></td><td style="border:1px solid #333;padding:8px;">{{date_loss}}</td></tr>
<tr><td style="border:1px solid #333;padding:8px;"><strong>Loss Location</strong></td><td style="border:1px solid #333;padding:8px;">{{loss_location}}</td></tr>
</table>
<h3>4. ASSESSMENT</h3>
<table style="border-collapse:collapse;width:100%;">
<tr><td style="border:1px solid #333;padding:8px;width:40%;"><strong>Gross Loss Claimed</strong></td><td style="border:1px solid #333;padding:8px;">Rs. {{gross_loss}}/-</td></tr>
<tr><td style="border:1px solid #333;padding:8px;"><strong>Assessed Loss</strong></td><td style="border:1px solid #333;padding:8px;">Rs. {{assessed_loss}}/-</td></tr>
</table>
<h3>5. RECOMMENDATION</h3>
<p>Based on our survey and assessment, we recommend settlement of <strong>Rs. {{assessed_loss}}/-</strong> (Rupees [amount in words] Only) subject to terms and conditions of the policy.</p>
<p>[Additional conditions or remarks]</p>
<br/>
<p>Yours faithfully,<br/><br/><br/><strong>{{surveyor_name}}</strong><br/>{{company}}<br/>IRDA License No: [License Number]</p>',
true, 'System'),

-- Marine Cargo LOR Template
('Marine Cargo LOR', 'LOR', 'Marine Cargo', 'Development',
'<h2 style="text-align:center;">LETTER OF RECOMMENDATION</h2>
<p style="text-align:center;"><strong>{{company}}</strong></p>
<p style="text-align:right;">Date: {{date_today}}</p>
<hr/>
<p><strong>To,</strong><br/>{{appointing_insurer}}</p>
<p><strong>Subject:</strong> Marine Cargo Loss Assessment - LOR<br/>
<strong>Ref No:</strong> {{ref_number}}<br/>
<strong>Claim No:</strong> {{claim_number}}<br/>
<strong>Policy No:</strong> {{policy_number}}<br/>
<strong>Insured:</strong> {{insured_name}}</p>
<hr/>
<p>Dear Sir/Madam,</p>
<p>We submit herewith our Letter of Recommendation regarding the above-mentioned Marine Cargo claim.</p>
<h3>1. CONSIGNMENT DETAILS</h3>
<table style="border-collapse:collapse;width:100%;">
<tr><td style="border:1px solid #333;padding:8px;width:40%;"><strong>Consignor</strong></td><td style="border:1px solid #333;padding:8px;">{{consignor}}</td></tr>
<tr><td style="border:1px solid #333;padding:8px;"><strong>Consignee</strong></td><td style="border:1px solid #333;padding:8px;">{{consignee}}</td></tr>
<tr><td style="border:1px solid #333;padding:8px;"><strong>Mode of Transit</strong></td><td style="border:1px solid #333;padding:8px;">[Road/Rail/Sea/Air]</td></tr>
<tr><td style="border:1px solid #333;padding:8px;"><strong>Vehicle/Vessel</strong></td><td style="border:1px solid #333;padding:8px;">{{vessel_name}}</td></tr>
</table>
<h3>2. NATURE OF DAMAGE</h3>
<p>[Describe the nature of transit damage, extent, packing condition, etc.]</p>
<h3>3. LOSS ASSESSMENT</h3>
<table style="border-collapse:collapse;width:100%;">
<tr><td style="border:1px solid #333;padding:8px;width:40%;"><strong>Invoice Value</strong></td><td style="border:1px solid #333;padding:8px;">Rs. {{gross_loss}}/-</td></tr>
<tr><td style="border:1px solid #333;padding:8px;"><strong>Assessed Loss</strong></td><td style="border:1px solid #333;padding:8px;">Rs. {{assessed_loss}}/-</td></tr>
<tr><td style="border:1px solid #333;padding:8px;"><strong>Salvage Value</strong></td><td style="border:1px solid #333;padding:8px;">Rs. [salvage]/-</td></tr>
<tr><td style="border:1px solid #333;padding:8px;"><strong>Net Loss</strong></td><td style="border:1px solid #333;padding:8px;">Rs. {{assessed_loss}}/-</td></tr>
</table>
<h3>4. RECOMMENDATION</h3>
<p>We recommend settlement of <strong>Rs. {{assessed_loss}}/-</strong> subject to policy terms and conditions.</p>
<br/>
<p>Yours faithfully,<br/><br/><br/><strong>{{surveyor_name}}</strong><br/>{{company}}</p>',
true, 'System'),

-- General ILA Template
('ILA - Standard', 'ILA', NULL, 'Development',
'<h2 style="text-align:center;">INTERIM LOSS ASSESSMENT</h2>
<p style="text-align:center;"><strong>{{company}}</strong></p>
<p style="text-align:right;">Date: {{date_today}}</p>
<hr/>
<p><strong>To,</strong><br/>{{appointing_insurer}}</p>
<p><strong>Subject:</strong> Interim Loss Assessment<br/>
<strong>Ref No:</strong> {{ref_number}}<br/>
<strong>Claim No:</strong> {{claim_number}}<br/>
<strong>Policy No:</strong> {{policy_number}} ({{policy_type}})<br/>
<strong>Insured:</strong> {{insured_name}}<br/>
<strong>LOB:</strong> {{lob}}</p>
<hr/>
<p>Dear Sir/Madam,</p>
<p>In reference to the above claim, we submit our Interim Loss Assessment report for your on-account settlement consideration.</p>
<h3>1. CLAIM PARTICULARS</h3>
<table style="border-collapse:collapse;width:100%;">
<tr><td style="border:1px solid #333;padding:8px;width:40%;"><strong>Date of Loss</strong></td><td style="border:1px solid #333;padding:8px;">{{date_loss}}</td></tr>
<tr><td style="border:1px solid #333;padding:8px;"><strong>Date of Intimation</strong></td><td style="border:1px solid #333;padding:8px;">{{date_intimation}}</td></tr>
<tr><td style="border:1px solid #333;padding:8px;"><strong>Date of Survey</strong></td><td style="border:1px solid #333;padding:8px;">{{date_survey}}</td></tr>
<tr><td style="border:1px solid #333;padding:8px;"><strong>Location of Loss</strong></td><td style="border:1px solid #333;padding:8px;">{{loss_location}}</td></tr>
<tr><td style="border:1px solid #333;padding:8px;"><strong>Cause of Loss</strong></td><td style="border:1px solid #333;padding:8px;">[Describe cause]</td></tr>
</table>
<h3>2. INTERIM ASSESSMENT</h3>
<p>Based on our preliminary survey and available documentation, the interim assessment is as follows:</p>
<table style="border-collapse:collapse;width:100%;">
<tr style="background:#f0f0f0;"><th style="border:1px solid #333;padding:8px;text-align:left;">Particulars</th><th style="border:1px solid #333;padding:8px;text-align:right;">Amount (Rs.)</th></tr>
<tr><td style="border:1px solid #333;padding:8px;">Gross Loss as Claimed</td><td style="border:1px solid #333;padding:8px;text-align:right;">{{gross_loss}}</td></tr>
<tr><td style="border:1px solid #333;padding:8px;">Less: Under-insurance / Excess</td><td style="border:1px solid #333;padding:8px;text-align:right;">[amount]</td></tr>
<tr><td style="border:1px solid #333;padding:8px;">Less: Salvage</td><td style="border:1px solid #333;padding:8px;text-align:right;">[amount]</td></tr>
<tr style="background:#f0f0f0;"><td style="border:1px solid #333;padding:8px;"><strong>Interim Assessed Loss</strong></td><td style="border:1px solid #333;padding:8px;text-align:right;"><strong>{{assessed_loss}}</strong></td></tr>
</table>
<h3>3. RECOMMENDATION</h3>
<p>We recommend an on-account payment of <strong>Rs. {{assessed_loss}}/-</strong> as interim settlement. The final assessment is subject to completion of our detailed survey and receipt of all required documents.</p>
<h3>4. DOCUMENTS PENDING</h3>
<ul>
<li>[List pending documents]</li>
<li>[e.g., FIR Copy, Fire Brigade Report, Stock Register, etc.]</li>
</ul>
<br/>
<p>Yours faithfully,<br/><br/><br/><strong>{{surveyor_name}}</strong><br/>{{company}}<br/>IRDA License No: [License Number]</p>',
true, 'System'),

-- Engineering LOR Template
('Engineering LOR - CAR/EAR', 'LOR', 'Engineering', 'Development',
'<h2 style="text-align:center;">LETTER OF RECOMMENDATION</h2>
<p style="text-align:center;"><strong>{{company}}</strong></p>
<p style="text-align:right;">Date: {{date_today}}</p>
<hr/>
<p><strong>To,</strong><br/>{{appointing_insurer}}</p>
<p><strong>Subject:</strong> Engineering Loss - Letter of Recommendation<br/>
<strong>Ref No:</strong> {{ref_number}} | <strong>Claim No:</strong> {{claim_number}}<br/>
<strong>Policy No:</strong> {{policy_number}} ({{policy_type}})<br/>
<strong>Insured:</strong> {{insured_name}}</p>
<hr/>
<p>Dear Sir/Madam,</p>
<p>We have completed our assessment of the above engineering claim and submit our recommendation.</p>
<h3>1. PROJECT/EQUIPMENT DETAILS</h3>
<p>[Describe the project or equipment involved]</p>
<h3>2. INCIDENT DESCRIPTION</h3>
<p>The incident occurred on <strong>{{date_loss}}</strong> at <strong>{{loss_location}}</strong>.</p>
<p>[Detailed description of the incident]</p>
<h3>3. ASSESSMENT SUMMARY</h3>
<table style="border-collapse:collapse;width:100%;">
<tr style="background:#f0f0f0;"><th style="border:1px solid #333;padding:8px;text-align:left;">Item</th><th style="border:1px solid #333;padding:8px;text-align:right;">Amount (Rs.)</th></tr>
<tr><td style="border:1px solid #333;padding:8px;">Repair/Replacement Cost</td><td style="border:1px solid #333;padding:8px;text-align:right;">{{gross_loss}}</td></tr>
<tr><td style="border:1px solid #333;padding:8px;">Less: Depreciation</td><td style="border:1px solid #333;padding:8px;text-align:right;">[amount]</td></tr>
<tr><td style="border:1px solid #333;padding:8px;">Less: Salvage</td><td style="border:1px solid #333;padding:8px;text-align:right;">[amount]</td></tr>
<tr><td style="border:1px solid #333;padding:8px;">Less: Excess/Deductible</td><td style="border:1px solid #333;padding:8px;text-align:right;">[amount]</td></tr>
<tr style="background:#f0f0f0;"><td style="border:1px solid #333;padding:8px;"><strong>Net Assessed Loss</strong></td><td style="border:1px solid #333;padding:8px;text-align:right;"><strong>{{assessed_loss}}</strong></td></tr>
</table>
<h3>4. RECOMMENDATION</h3>
<p>We recommend settlement of <strong>Rs. {{assessed_loss}}/-</strong> subject to policy terms, conditions, and applicable deductible.</p>
<br/>
<p>Yours faithfully,<br/><br/><br/><strong>{{surveyor_name}}</strong><br/>{{company}}</p>',
true, 'System');

-- ============================================
-- 6. SAMPLE CLAIM STAGES (lifecycle tracking)
-- ============================================
-- For claim DEV-001 (Fire - Mehta Textiles - In Process)
INSERT INTO claim_stages (claim_id, stage, stage_date, notes)
SELECT id, 'Intimation', '2026-03-15', 'Claim intimated by New India Assurance Mumbai RO'
FROM claims WHERE ref_number = 'DEV-001/26-27/Fire' AND company = 'Development';

INSERT INTO claim_stages (claim_id, stage, stage_date, notes)
SELECT id, 'Survey Scheduled', '2026-03-16', 'Survey scheduled for 18th March'
FROM claims WHERE ref_number = 'DEV-001/26-27/Fire' AND company = 'Development';

INSERT INTO claim_stages (claim_id, stage, stage_date, notes)
SELECT id, 'Survey Done', '2026-03-18', 'Initial survey completed. Fire damage documented.'
FROM claims WHERE ref_number = 'DEV-001/26-27/Fire' AND company = 'Development';

INSERT INTO claim_stages (claim_id, stage, stage_date, notes)
SELECT id, 'Assessment', '2026-03-22', 'Assessment in progress. Awaiting stock records.'
FROM claims WHERE ref_number = 'DEV-001/26-27/Fire' AND company = 'Development';

-- For claim DEV-002 (Fire - Sharma Industries - Submitted)
INSERT INTO claim_stages (claim_id, stage, stage_date, notes)
SELECT id, 'Intimation', '2026-03-20', 'Claim received from United India Pune RO'
FROM claims WHERE ref_number = 'DEV-002/26-27/Fire' AND company = 'Development';

INSERT INTO claim_stages (claim_id, stage, stage_date, notes)
SELECT id, 'Survey Done', '2026-03-22', 'Survey completed'
FROM claims WHERE ref_number = 'DEV-002/26-27/Fire' AND company = 'Development';

INSERT INTO claim_stages (claim_id, stage, stage_date, notes)
SELECT id, 'Assessment', '2026-03-24', 'Full assessment done. Loss quantified.'
FROM claims WHERE ref_number = 'DEV-002/26-27/Fire' AND company = 'Development';

INSERT INTO claim_stages (claim_id, stage, stage_date, notes)
SELECT id, 'Report Drafted', '2026-03-25', 'Final report drafted for review'
FROM claims WHERE ref_number = 'DEV-002/26-27/Fire' AND company = 'Development';

INSERT INTO claim_stages (claim_id, stage, stage_date, notes)
SELECT id, 'Report Submitted', '2026-03-26', 'Report submitted to United India Insurance'
FROM claims WHERE ref_number = 'DEV-002/26-27/Fire' AND company = 'Development';

-- For claim DEV-005 (Engineering - Larsen - Submitted)
INSERT INTO claim_stages (claim_id, stage, stage_date, notes)
SELECT id, 'Intimation', '2026-03-10', 'Claim received'
FROM claims WHERE ref_number = 'DEV-005/26-27/Engg' AND company = 'Development';

INSERT INTO claim_stages (claim_id, stage, stage_date, notes)
SELECT id, 'Survey Done', '2026-03-14', 'Site survey completed at NH-48'
FROM claims WHERE ref_number = 'DEV-005/26-27/Engg' AND company = 'Development';

INSERT INTO claim_stages (claim_id, stage, stage_date, notes)
SELECT id, 'Report Submitted', '2026-03-22', 'LOR submitted with full documentation'
FROM claims WHERE ref_number = 'DEV-005/26-27/Engg' AND company = 'Development';

-- ============================================
-- 7. SAMPLE DOCUMENT TRACKING
-- ============================================
-- For claim DEV-001 (Fire - Mehta Textiles)
INSERT INTO claim_documents (claim_id, document_type, document_name, status)
SELECT id, 'Appointment Letter', 'Appointment Letter - NIA', 'Uploaded'
FROM claims WHERE ref_number = 'DEV-001/26-27/Fire' AND company = 'Development';

INSERT INTO claim_documents (claim_id, document_type, document_name, status)
SELECT id, 'Claim Form', 'Claim Form - Mehta Textiles', 'Uploaded'
FROM claims WHERE ref_number = 'DEV-001/26-27/Fire' AND company = 'Development';

INSERT INTO claim_documents (claim_id, document_type, document_name, status)
SELECT id, 'Survey Photos', 'Site Photos - 18 March', 'Uploaded'
FROM claims WHERE ref_number = 'DEV-001/26-27/Fire' AND company = 'Development';

INSERT INTO claim_documents (claim_id, document_type, document_name, status)
SELECT id, 'Policy Copy', 'Policy FP-2026-1001', 'Uploaded'
FROM claims WHERE ref_number = 'DEV-001/26-27/Fire' AND company = 'Development';

INSERT INTO claim_documents (claim_id, document_type, document_name, status, remarks)
SELECT id, 'LOR', 'LOR - Pending', 'Pending', 'To be generated after stock records received'
FROM claims WHERE ref_number = 'DEV-001/26-27/Fire' AND company = 'Development';

-- For claim DEV-002 (Fire - Sharma Industries - Submitted)
INSERT INTO claim_documents (claim_id, document_type, document_name, status)
SELECT id, 'Appointment Letter', 'Appointment - UII Pune', 'Uploaded'
FROM claims WHERE ref_number = 'DEV-002/26-27/Fire' AND company = 'Development';

INSERT INTO claim_documents (claim_id, document_type, document_name, status)
SELECT id, 'Survey Photos', 'Photos - Sharma Industries', 'Uploaded'
FROM claims WHERE ref_number = 'DEV-002/26-27/Fire' AND company = 'Development';

INSERT INTO claim_documents (claim_id, document_type, document_name, status)
SELECT id, 'LOR', 'LOR - Sharma Industries', 'Generated'
FROM claims WHERE ref_number = 'DEV-002/26-27/Fire' AND company = 'Development';

INSERT INTO claim_documents (claim_id, document_type, document_name, status)
SELECT id, 'Survey Fee Bill', 'Bill DEV/SF/0002', 'Sent'
FROM claims WHERE ref_number = 'DEV-002/26-27/Fire' AND company = 'Development';

-- For claim DEV-TMT-001 (Marine - Tata Motors)
INSERT INTO claim_documents (claim_id, document_type, document_name, status)
SELECT id, 'Appointment Letter', 'Appointment - NIA Marine', 'Uploaded'
FROM claims WHERE ref_number = 'DEV-TMT-001/26-27' AND company = 'Development';

INSERT INTO claim_documents (claim_id, document_type, document_name, status)
SELECT id, 'Survey Photos', 'Transit Damage Photos', 'Uploaded'
FROM claims WHERE ref_number = 'DEV-TMT-001/26-27' AND company = 'Development';

INSERT INTO claim_documents (claim_id, document_type, document_name, status)
SELECT id, 'LOR', 'LOR - Tata Motors', 'Generated'
FROM claims WHERE ref_number = 'DEV-TMT-001/26-27' AND company = 'Development';
