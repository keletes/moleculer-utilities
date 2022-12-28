import { ServiceSchema } from 'moleculer';
import defaultsDeep from 'lodash.defaultsdeep';
import {createServer, STATUS_CODES} from 'http';
import type {Server, IncomingMessage, ServerResponse} from 'http';

interface Options {
  readiness: {
    path: string
  },
  liveness: {
    path: string
  },
  port: string
}

export default function K8sMiddleware(opts?: Options): Omit<ServiceSchema, 'name'> {
  const options = defaultsDeep(opts, {
    port: 3001,
    readiness: {
      path: "/ready",
    },
    liveness: {
      path: "/live",
    },
  }) as Options;

  let state = "down";
  let server: Server;

  function handler(req: IncomingMessage, res: ServerResponse) {
    if (req.url == options.readiness.path || req.url == options.liveness.path) {
      const resHeader = {
        "Content-Type": "application/json; charset=utf-8",
      };

      const content = {
        state,
        uptime: process.uptime(),
        timestamp: Date.now(),
      };

      if (req.url == options.readiness.path) {
        // Readiness if the broker started successfully.
        // https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#define-readiness-probes
        res.writeHead(state == "up" ? 200 : 503, resHeader);
      } else {
        // Liveness if the broker is not stopped.
        // https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#define-a-liveness-command
        res.writeHead(state != "down" ? 200 : 503, resHeader);
      }

      res.end(JSON.stringify(content, null, 2));
    } else {
      res.writeHead(404, STATUS_CODES[404], {});
      res.end();
    }
  }

  return {
    created() {
      state = "starting";

      server = createServer(handler);
      server.listen(options.port, (err?: Error) => {
        if (err) {
          return this.broker.logger.error(
            "Unable to start health-check server",
            err
          );
        }

        this.broker.logger.info("");
        this.broker.logger.info("K8s health-check server listening on");
        this.broker.logger.info(
          `    http://localhost:${options.port}${options.readiness.path}`
        );
        this.broker.logger.info(
          `    http://localhost:${options.port}${options.liveness.path}`
        );
        this.broker.logger.info("");
      });
    },

    // After broker started
    started() {
      state = "up";
    },

    // Before broker stopping
    stopping() {
      state = "stopping";
    },

    // After broker stopped
    stopped() {
      state = "down";
      server.close();
    },
  };
};
