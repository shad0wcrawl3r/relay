package config

import (
	"log"

	"github.com/spf13/viper"
)

var cfg Config

func init() {
	viper.SetEnvPrefix("RELAY")
	viper.SetConfigFile("config.toml")
	viper.SetConfigType("toml")
	viper.SetDefault("plane.BASE_URL", "https://api.plane.so")
	cfg = Config{}
	if err := viper.ReadInConfig(); err != nil {
		log.Panic("Could not parse env. Err: ", err)
	}
	if err := viper.Unmarshal(&cfg); err != nil {
		log.Panic("Could not unmarshall env. Err: ", err)
	}

	log.Println(cfg)
}

func GetConfig() *Config {
	return &cfg
}

type Config struct {
	DevTo struct {
		APIKey string `mapstructure:"API_KEY"`
	}
	Plane struct {
		BaseURL      string `mapstructure:"BASE_URL"`
		ClientID     string `mapstructure:"CLIENT_ID"`
		ClientSecret string `mapstructure:"CLIENT_SECRET"`
		// APIKey  string `mapstructure:"API_KEY"`
	}
}
