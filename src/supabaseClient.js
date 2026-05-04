import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://chbjgrvjnwygogjbktpa.supabase.co'
const supabaseKey = 'sb_publishable_6pbzMCq44L1YEcMgj7_u2w_4iA4BzLy'

export const supabase = createClient(supabaseUrl, supabaseKey)