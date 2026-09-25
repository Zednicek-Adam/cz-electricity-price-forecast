\restrict dbmate

-- Dumped from database version 17.11 (Debian 17.11-1.pgdg13+2)
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: forecast; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forecast (
    delivery_date date NOT NULL,
    period_ordinal integer NOT NULL,
    resolution_minutes integer NOT NULL,
    model text NOT NULL,
    run_type text NOT NULL,
    price numeric NOT NULL,
    model_version text NOT NULL,
    code_version text NOT NULL,
    executed_at timestamp with time zone NOT NULL,
    CONSTRAINT forecast_run_type_check CHECK ((run_type = ANY (ARRAY['backtest'::text, 'live'::text])))
);


--
-- Name: model_comparison; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_comparison (
    model_a text NOT NULL,
    model_b text NOT NULL,
    run_type text NOT NULL,
    period_ordinal integer NOT NULL,
    resolution_minutes integer NOT NULL,
    dm_statistic numeric NOT NULL,
    p_value numeric NOT NULL,
    computed_at timestamp with time zone NOT NULL,
    CONSTRAINT model_comparison_run_type_check CHECK ((run_type = ANY (ARRAY['backtest'::text, 'live'::text])))
);


--
-- Name: observed_price; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.observed_price (
    delivery_start timestamp with time zone NOT NULL,
    resolution_minutes integer NOT NULL,
    price numeric NOT NULL,
    source text NOT NULL,
    retrieved_at timestamp with time zone NOT NULL
);


--
-- Name: published_metric; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.published_metric (
    model text NOT NULL,
    run_type text NOT NULL,
    scope_type text NOT NULL,
    scope_start date NOT NULL,
    metric text NOT NULL,
    value numeric NOT NULL,
    n_forecasts integer NOT NULL,
    computed_at timestamp with time zone NOT NULL,
    CONSTRAINT published_metric_run_type_check CHECK ((run_type = ANY (ARRAY['backtest'::text, 'live'::text])))
);


--
-- Name: repaired_observed_price; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repaired_observed_price (
    delivery_date date NOT NULL,
    period_ordinal integer NOT NULL,
    resolution_minutes integer NOT NULL,
    price numeric NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: forecast forecast_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forecast
    ADD CONSTRAINT forecast_pkey PRIMARY KEY (delivery_date, period_ordinal, resolution_minutes, model, run_type);


--
-- Name: model_comparison model_comparison_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_comparison
    ADD CONSTRAINT model_comparison_pkey PRIMARY KEY (model_a, model_b, run_type, period_ordinal, resolution_minutes);


--
-- Name: observed_price observed_price_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observed_price
    ADD CONSTRAINT observed_price_pkey PRIMARY KEY (delivery_start, resolution_minutes);


--
-- Name: published_metric published_metric_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.published_metric
    ADD CONSTRAINT published_metric_pkey PRIMARY KEY (model, run_type, scope_type, scope_start, metric);


--
-- Name: repaired_observed_price repaired_observed_price_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repaired_observed_price
    ADD CONSTRAINT repaired_observed_price_pkey PRIMARY KEY (delivery_date, period_ordinal, resolution_minutes);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: forecast_delivery_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX forecast_delivery_date_idx ON public.forecast USING btree (delivery_date);


--
-- Name: published_metric_model_scope_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX published_metric_model_scope_type_idx ON public.published_metric USING btree (model, scope_type);


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20260909000000'),
    ('20260925000000'),
    ('20260925000001');
