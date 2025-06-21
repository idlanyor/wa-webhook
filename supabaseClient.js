require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase URL and Anon Key are required. Please check your .env file.");
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase; 