const got = require("got");
const _ = require("lodash");
const url = require("url");
const port = 8080;

const cache = new Map();

const systems = new Map();
const stargatesCache = new Map();

const flatten = arr => [].concat(...arr);

const getConstellation = async id =>
  (await got(
    `https://esi.evetech.net/latest/universe/regions/${id}/?datasource=tranquility&language=en-us`,
    { json: true, cache }
  )).body.constellations;

const getSystemsInConstellation = async constellation =>
  (await got(
    `https://esi.evetech.net/latest/universe/constellations/${constellation}/?datasource=tranquility&language=en-us`,
    { json: true, cache }
  )).body.systems;

const getStargates = async systemId => {
  const system = (await got(
    `https://esi.evetech.net/latest/universe/systems/${systemId}/?datasource=tranquility&language=en-us`,
    { json: true, cache }
  )).body;
  systems.set(systemId, system);
  return {
    systemId,
    stargates: system.stargates
  };
};

const getStargateDesti = async stargateId =>
  (await got(
    `https://esi.evetech.net/latest/universe/stargates/${stargateId}/?datasource=tranquility&language=en-us`,
    { json: true, cache }
  )).body.destination.system_id;

const getSystemName = async systemId => {
  if (systems.get(systemId)) {
    return systems.get(systemId).name;
  }
  const system = (await got(
    `https://esi.evetech.net/latest/universe/systems/${systemId}/?datasource=tranquility&language=en-us`,
    { json: true, cache }
  )).body;
  systems.set(systemId, system);
  return system.name;
};

async function getSystemsWithConnections(regionId) {
  const constellations = await getConstellation(regionId);
  const systemIds = await Promise.all(
    constellations.map(constellation =>
      getSystemsInConstellation(constellation)
    )
  );
  const stargates = await Promise.all(
    flatten(systemIds).map(system => getStargates(system))
  );
  const stargatebatches = _.chunk(
    flatten(stargates.map(fst => fst.stargates)),
    10
  );
  for (const batch of stargatebatches) {
    await Promise.all(
      batch.map(async id => {
        const desti = await getStargateDesti(id);
        stargatesCache.set(id, desti);
      })
    );
  }

  const systemsArr = [];

  for (const system of systems.values()) {
    systemsArr.push(system);
  }

  const systemsWithDestinations = await Promise.all(
    systemsArr.map(async system => ({
      systemId: system.system_id,
      name: system.name,
      stargates: await Promise.all(
        system.stargates
          .map(stargate => stargatesCache.get(stargate))
          .map(async systemId => await getSystemName(systemId))
      )
    }))
  );

  return systemsWithDestinations;
}

const requestHandler = (req, res) => {
  if (!req.query.region) {
    return res.status(400).json({
      message:
        "Missing parameters, make sure to pass a region ID in a query string like ?region=12345"
    });
  }
  getSystemsWithConnections(req.query.region)
    .then(data => {
      return res.json(data);
    })
    .catch(err => {
      console.log(err);
      res.status(500).send({
        message: "An error has occured."
      });
    });
};

module.exports = requestHandler;
