const express = require("express");
const client = require("@prometheus-io/client");

const app = express();

client.collectDefaultMetrics();

const requestCounter = new client.Counter({
	name: "app_http_requests_total",
	help: "Total number of HTTP requests",
	labelNames: ["method", "route", "status_code"],
});

const requestDuration = new client.Histogram({
	name: "app_http_request_duration_seconds",
	help: "HTTP request duration in seconds",
	labelNames: ["method", "route", "status_code"],
});

const healthCheckCounter = new client.Counter({
	name: "app_health_checks_total",
	help: "Total number of health checks",
});

app.use((req, res, next) => {
	const startedAt = process.hrtime.bigint();
	const end = requestDuration.startTimer({
		method: req.method,
	});

	res.on("finish", () => {
		requestCounter.inc({
			method: req.method,
			route: req.path,
			status_code: res.statusCode.toString(),
		});

		end({
			route: req.path,
			status_code: res.statusCode.toString(),
		});

		console.log(
			JSON.stringify({
				event: "http_request",
				method: req.method,
				path: req.path,
				status_code: res.statusCode,
				duration_ms: Number(process.hrtime.bigint() - startedAt) / 1e6,
			}),
		);
	});

	next();
});

app.get("/", (req, res) => {
	res.send("Sherlock Logs");
});

app.get("/health", (req, res) => {
	healthCheckCounter.inc();

	res.json({
		status: "ok",
	});
});

app.get("/metrics", async (req, res) => {
	res.set("Content-Type", client.register.contentType);
	res.end(await client.register.metrics());
});

app.use((error, req, res, next) => {
	console.error(
		JSON.stringify({
			event: "request_error",
			method: req.method,
			path: req.path,
			error: error.message,
		}),
	);

	if (res.headersSent) {
		return next(error);
	}

	res.status(500).json({ error: "Internal Server Error" });
});

app.listen(3000, "0.0.0.0", () => {
	console.log(
		JSON.stringify({
			event: "application_started",
			port: 3000,
		}),
	);
});
