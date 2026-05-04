-- =============================================================================
-- 20260504104553_seed_psu_insurers.sql
-- =============================================================================
-- Idempotent seed for the four PSU insurers (NIA, OICL, NICL, UIIC) with
-- their Head Office + Regional Office structure. Runs after the hierarchy
-- migration so office_code / parent_office_id / is_active columns exist.
--
-- Matching strategy (per row):
--   1. Try to find the insurer by `code`.
--   2. Fallback: match by `company_name` (the existing initial_schema seed
--      uses 'NIAC' for New India; the spec uses 'NIA'. Either match works.)
--
-- Office data:
--   * Each insurer gets a Head Office.
--   * Plus 28-30 Regional Offices covering metros + state capitals.
--   * Phone / email / address are left NULL — verifying these per office
--     across 4 insurers is out of scope for a seed; the clerk fills them
--     via the insurer-master UI as they encounter live claims.
--
-- Idempotency:
--   * upsert_insurer() and upsert_office() both look the row up by a
--     business key first, and INSERT only if missing. Re-running the
--     migration is a no-op once the rows exist.
--   * Helper functions are DROPped at the end so they don't leak.
-- =============================================================================

BEGIN;

-- ----- Helper: upsert_insurer -----
-- Returns the id of the matching insurer row, creating it if neither the
-- code nor the company_name match anything.
CREATE OR REPLACE FUNCTION pg_temp.upsert_insurer(
    p_code         TEXT,
    p_company_name TEXT,
    p_city         TEXT
) RETURNS BIGINT AS $$
DECLARE
    v_id BIGINT;
BEGIN
    -- 1. By code.
    SELECT id INTO v_id FROM public.insurers WHERE code = p_code LIMIT 1;
    IF v_id IS NOT NULL THEN
        RETURN v_id;
    END IF;

    -- 2. By company_name.
    SELECT id INTO v_id FROM public.insurers WHERE company_name = p_company_name LIMIT 1;
    IF v_id IS NOT NULL THEN
        RETURN v_id;
    END IF;

    -- 3. Insert fresh.
    INSERT INTO public.insurers (code, company_name, city, status)
    VALUES (p_code, p_company_name, p_city, 'Active')
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ----- Helper: upsert_office -----
-- Looks up by (insurer_id, office_code, name). If a matching row exists,
-- returns its id and updates parent_office_id + city if those were null.
-- Otherwise inserts. The trigger from the hierarchy migration mirrors
-- office_code → legacy type column on the way in.
CREATE OR REPLACE FUNCTION pg_temp.upsert_office(
    p_insurer_id BIGINT,
    p_office_code TEXT,
    p_name        TEXT,
    p_city        TEXT,
    p_parent_id   BIGINT
) RETURNS BIGINT AS $$
DECLARE
    v_id BIGINT;
BEGIN
    SELECT id INTO v_id
    FROM public.insurer_offices
    WHERE insurer_id = p_insurer_id
      AND office_code = p_office_code
      AND name        = p_name
    LIMIT 1;

    IF v_id IS NOT NULL THEN
        -- Top up missing fields without clobbering anything already set.
        UPDATE public.insurer_offices
        SET
            parent_office_id = COALESCE(parent_office_id, p_parent_id),
            city             = COALESCE(NULLIF(city, ''), p_city),
            is_active        = TRUE
        WHERE id = v_id;
        RETURN v_id;
    END IF;

    INSERT INTO public.insurer_offices (
        insurer_id, office_code, name, city, parent_office_id, is_active
    )
    VALUES (
        p_insurer_id, p_office_code, p_name, p_city, p_parent_id, TRUE
    )
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Seed each PSU
-- =============================================================================

DO $$
DECLARE
    ins_id BIGINT;
    ho_id  BIGINT;
BEGIN
    -- ============================================================
    -- The New India Assurance Co. Ltd. (NIA / NIAC)
    -- ============================================================
    ins_id := pg_temp.upsert_insurer(
        'NIA',
        'The New India Assurance Co. Ltd.',
        'Mumbai'
    );

    ho_id  := pg_temp.upsert_office(ins_id, 'HO',  'New India Assurance — Head Office', 'Mumbai',     NULL);

    -- 30 ROs across metros + state capitals.
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Mumbai Regional Office',          'Mumbai',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Delhi Regional Office',           'New Delhi',      ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Kolkata Regional Office',         'Kolkata',        ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Chennai Regional Office',         'Chennai',        ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Bengaluru Regional Office',       'Bengaluru',      ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Hyderabad Regional Office',       'Hyderabad',      ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Ahmedabad Regional Office',       'Ahmedabad',      ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Pune Regional Office',            'Pune',           ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Jaipur Regional Office',          'Jaipur',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Lucknow Regional Office',         'Lucknow',        ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Patna Regional Office',           'Patna',          ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Bhopal Regional Office',          'Bhopal',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Chandigarh Regional Office',      'Chandigarh',     ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Bhubaneswar Regional Office',     'Bhubaneswar',    ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Guwahati Regional Office',        'Guwahati',       ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Kochi Regional Office',           'Kochi',          ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Thiruvananthapuram Regional Office','Thiruvananthapuram', ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Coimbatore Regional Office',      'Coimbatore',     ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Nagpur Regional Office',          'Nagpur',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Indore Regional Office',          'Indore',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Vadodara Regional Office',        'Vadodara',       ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Surat Regional Office',           'Surat',          ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Visakhapatnam Regional Office',   'Visakhapatnam',  ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Ranchi Regional Office',          'Ranchi',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Raipur Regional Office',          'Raipur',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Dehradun Regional Office',        'Dehradun',       ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Shimla Regional Office',          'Shimla',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Srinagar Regional Office',        'Srinagar',       ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Panaji Regional Office',          'Panaji',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Agartala Regional Office',        'Agartala',       ho_id);

    -- ============================================================
    -- The Oriental Insurance Co. Ltd. (OICL)
    -- ============================================================
    ins_id := pg_temp.upsert_insurer(
        'OICL',
        'The Oriental Insurance Co. Ltd.',
        'New Delhi'
    );
    ho_id  := pg_temp.upsert_office(ins_id, 'HO', 'Oriental Insurance — Head Office', 'New Delhi',  NULL);

    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Delhi Regional Office',           'New Delhi',      ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Mumbai Regional Office',          'Mumbai',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Kolkata Regional Office',         'Kolkata',        ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Chennai Regional Office',         'Chennai',        ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Bengaluru Regional Office',       'Bengaluru',      ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Hyderabad Regional Office',       'Hyderabad',      ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Ahmedabad Regional Office',       'Ahmedabad',      ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Pune Regional Office',            'Pune',           ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Jaipur Regional Office',          'Jaipur',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Lucknow Regional Office',         'Lucknow',        ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Patna Regional Office',           'Patna',          ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Bhopal Regional Office',          'Bhopal',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Chandigarh Regional Office',      'Chandigarh',     ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Bhubaneswar Regional Office',     'Bhubaneswar',    ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Guwahati Regional Office',        'Guwahati',       ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Kochi Regional Office',           'Kochi',          ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Thiruvananthapuram Regional Office','Thiruvananthapuram', ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Coimbatore Regional Office',      'Coimbatore',     ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Nagpur Regional Office',          'Nagpur',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Indore Regional Office',          'Indore',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Vadodara Regional Office',        'Vadodara',       ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Visakhapatnam Regional Office',   'Visakhapatnam',  ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Ranchi Regional Office',          'Ranchi',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Raipur Regional Office',          'Raipur',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Dehradun Regional Office',        'Dehradun',       ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Shimla Regional Office',          'Shimla',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Srinagar Regional Office',        'Srinagar',       ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Jammu Regional Office',           'Jammu',          ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Panaji Regional Office',          'Panaji',         ho_id);

    -- ============================================================
    -- National Insurance Co. Ltd. (NICL)
    -- ============================================================
    ins_id := pg_temp.upsert_insurer(
        'NICL',
        'National Insurance Co. Ltd.',
        'Kolkata'
    );
    ho_id  := pg_temp.upsert_office(ins_id, 'HO', 'National Insurance — Head Office', 'Kolkata',    NULL);

    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Kolkata Regional Office',         'Kolkata',        ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Mumbai Regional Office',          'Mumbai',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Delhi Regional Office',           'New Delhi',      ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Chennai Regional Office',         'Chennai',        ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Bengaluru Regional Office',       'Bengaluru',      ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Hyderabad Regional Office',       'Hyderabad',      ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Ahmedabad Regional Office',       'Ahmedabad',      ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Pune Regional Office',            'Pune',           ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Jaipur Regional Office',          'Jaipur',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Lucknow Regional Office',         'Lucknow',        ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Patna Regional Office',           'Patna',          ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Bhopal Regional Office',          'Bhopal',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Chandigarh Regional Office',      'Chandigarh',     ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Bhubaneswar Regional Office',     'Bhubaneswar',    ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Guwahati Regional Office',        'Guwahati',       ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Kochi Regional Office',           'Kochi',          ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Thiruvananthapuram Regional Office','Thiruvananthapuram', ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Coimbatore Regional Office',      'Coimbatore',     ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Nagpur Regional Office',          'Nagpur',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Indore Regional Office',          'Indore',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Vadodara Regional Office',        'Vadodara',       ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Visakhapatnam Regional Office',   'Visakhapatnam',  ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Siliguri Regional Office',        'Siliguri',       ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Ranchi Regional Office',          'Ranchi',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Raipur Regional Office',          'Raipur',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Dehradun Regional Office',        'Dehradun',       ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Shimla Regional Office',          'Shimla',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Imphal Regional Office',          'Imphal',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Agartala Regional Office',        'Agartala',       ho_id);

    -- ============================================================
    -- United India Insurance Co. Ltd. (UIIC)
    -- ============================================================
    ins_id := pg_temp.upsert_insurer(
        'UIIC',
        'United India Insurance Co. Ltd.',
        'Chennai'
    );
    ho_id  := pg_temp.upsert_office(ins_id, 'HO', 'United India Insurance — Head Office', 'Chennai', NULL);

    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Chennai Regional Office',         'Chennai',        ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Mumbai Regional Office',          'Mumbai',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Delhi Regional Office',           'New Delhi',      ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Kolkata Regional Office',         'Kolkata',        ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Bengaluru Regional Office',       'Bengaluru',      ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Hyderabad Regional Office',       'Hyderabad',      ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Ahmedabad Regional Office',       'Ahmedabad',      ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Pune Regional Office',            'Pune',           ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Jaipur Regional Office',          'Jaipur',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Lucknow Regional Office',         'Lucknow',        ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Patna Regional Office',           'Patna',          ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Bhopal Regional Office',          'Bhopal',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Chandigarh Regional Office',      'Chandigarh',     ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Bhubaneswar Regional Office',     'Bhubaneswar',    ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Guwahati Regional Office',        'Guwahati',       ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Kochi Regional Office',           'Kochi',          ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Thiruvananthapuram Regional Office','Thiruvananthapuram', ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Coimbatore Regional Office',      'Coimbatore',     ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Madurai Regional Office',         'Madurai',        ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Tiruchirappalli Regional Office', 'Tiruchirappalli',ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Nagpur Regional Office',          'Nagpur',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Indore Regional Office',          'Indore',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Vadodara Regional Office',        'Vadodara',       ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Visakhapatnam Regional Office',   'Visakhapatnam',  ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Vijayawada Regional Office',      'Vijayawada',     ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Ranchi Regional Office',          'Ranchi',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Raipur Regional Office',          'Raipur',         ho_id);
    PERFORM pg_temp.upsert_office(ins_id, 'RO', 'Dehradun Regional Office',        'Dehradun',       ho_id);

END $$;

-- The temp helper functions live on pg_temp and disappear with the session,
-- but we DROP them explicitly per the spec for clarity / belt-and-braces.
DROP FUNCTION IF EXISTS pg_temp.upsert_insurer(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS pg_temp.upsert_office(BIGINT, TEXT, TEXT, TEXT, BIGINT);

NOTIFY pgrst, 'reload schema';

COMMIT;
