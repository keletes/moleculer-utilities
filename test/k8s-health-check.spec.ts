import http from "http";
import { ServiceBroker } from "moleculer";
import { K8sHealthCheck } from "../src/middlewares";

const PORT = 38093;
const get = (path: string): Promise<{ status: number; body: string }> =>
	new Promise((resolve, reject) => {
		http.get({ host: "127.0.0.1", port: PORT, path }, res => {
			let body = "";
			res.on("data", chunk => (body += chunk));
			res.on("end", () => resolve({ status: res.statusCode as number, body }));
		}).on("error", reject);
	});

describe("K8sHealthCheck", () => {
	const broker = new ServiceBroker({ logger: false, middlewares: [K8sHealthCheck({ port: PORT } as never)] });

	it("is ready and alive once started, and gone once stopped", async () => {
		await broker.start();
		expect((await get("/ready")).status).toBe(200);
		expect(JSON.parse((await get("/live")).body).state).toBe("up");
		expect((await get("/other")).status).toBe(404);
		await broker.stop();
	});
});
