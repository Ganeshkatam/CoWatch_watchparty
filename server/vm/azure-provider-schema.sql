-- ============================================================================
-- CoWatch VBrowser Database Schema: Azure Provider & Pools Seed
--
-- Inserts baseline configuration for Azure provider and pools in DRAFT status.
-- Migration inserts records as DRAFT/disabled so they do not participate in
-- active policy allocation until explicitly activated by an operator.
-- ============================================================================

-- 1. Insert Azure Provider (DRAFT)
INSERT INTO vbrowser_providers (
    id,
    display_name,
    provider_type,
    enabled,
    lifecycle,
    max_concurrent_sessions,
    max_sessions_per_user,
    max_sessions_per_room,
    max_large_sessions,
    max_session_duration_seconds,
    max_large_session_duration_seconds,
    config
) VALUES (
    'azure',
    'Azure Virtual Machines',
    'cloud',
    false,
    'DRAFT',
    10,
    2,
    1,
    2,
    10800,
    86400,
    '{"description": "Azure Resource Manager (ARM) VM infrastructure"}'::jsonb
) ON CONFLICT (id) DO UPDATE SET
    updated_at = now();

-- 2. Insert Standard Pool (AzureUS, DRAFT)
INSERT INTO vbrowser_pools (
    id,
    provider_id,
    region,
    is_large,
    min_size,
    limit_size,
    enabled,
    lifecycle,
    max_sessions_per_user,
    max_sessions_per_room,
    max_large_sessions,
    max_session_duration_seconds,
    max_large_session_duration_seconds,
    config
) VALUES (
    'AzureUS',
    'azure',
    'US',
    false,
    0,
    10,
    false,
    'DRAFT',
    2,
    1,
    0,
    10800,
    86400,
    '{"vmSize": "Standard_B2s", "location": "eastus"}'::jsonb
) ON CONFLICT (id) DO UPDATE SET
    updated_at = now();

-- 3. Insert Large Pool (AzureLargeUS, DRAFT)
INSERT INTO vbrowser_pools (
    id,
    provider_id,
    region,
    is_large,
    min_size,
    limit_size,
    enabled,
    lifecycle,
    max_sessions_per_user,
    max_sessions_per_room,
    max_large_sessions,
    max_session_duration_seconds,
    max_large_session_duration_seconds,
    config
) VALUES (
    'AzureLargeUS',
    'azure',
    'US',
    true,
    0,
    5,
    false,
    'DRAFT',
    2,
    1,
    2,
    10800,
    86400,
    '{"vmSize": "Standard_B4ms", "location": "eastus"}'::jsonb
) ON CONFLICT (id) DO UPDATE SET
    updated_at = now();

-- ============================================================================
-- ACTIVATION PHASE (Operator Manual Execution)
--
-- Once Azure credentials (AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, etc.)
-- and infrastructure (subnet, managed image) are provisioned in the environment,
-- promote provider and pools from DRAFT to ENABLED:
--
-- UPDATE vbrowser_providers
-- SET enabled = true, lifecycle = 'ENABLED', updated_at = now()
-- WHERE id = 'azure';
--
-- UPDATE vbrowser_pools
-- SET enabled = true, lifecycle = 'ENABLED', updated_at = now()
-- WHERE id IN ('AzureUS', 'AzureLargeUS');
-- ============================================================================
